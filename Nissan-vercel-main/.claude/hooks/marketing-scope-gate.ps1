# PreToolUse hook — marketing scope gate
# Exit 0 = allow. Exit 2 = block (stdout becomes Claude feedback).
#
# Allowed scope:
#   apps/web/src/routes/_authed/marketing*
#   apps/web/src/components/marketing/*
#   apps/web/src/lib/marketing.ts
#   docs/
#   .claude/
#
# Bypass: if .claude/scope-override.txt contains the exact relative path,
# the edit is allowed once (file deleted after use).

$raw = [System.Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $hook = $raw | ConvertFrom-Json } catch { exit 0 }

# Only intercept write-class tools
$writeable = @('Edit', 'Write', 'MultiEdit', 'NotebookEdit')
if ($hook.tool_name -notin $writeable) { exit 0 }

$filePath = $hook.tool_input.file_path
if (-not $filePath) { $filePath = $hook.tool_input.notebook_path }
if (-not $filePath) { exit 0 }

# Normalize to forward-slash relative path (strip project root)
$cwd = (Get-Location).Path.Replace('\', '/').ToLower()
$norm = $filePath.Replace('\', '/').ToLower()
if ($norm.StartsWith($cwd)) { $norm = $norm.Substring($cwd.Length).TrimStart('/') }

# ── Always-allowed patterns ──────────────────────────────────────────────────
$allowed = @(
    'apps/web/src/routes/_authed/marketing',
    'apps/web/src/components/marketing',
    'apps/web/src/lib/marketing.ts',
    'docs/',
    '.claude/'
)
foreach ($p in $allowed) { if ($norm.Contains($p)) { exit 0 } }

# ── One-time bypass (user-approved override) ─────────────────────────────────
$overrideFile = Join-Path (Get-Location).Path '.claude\scope-override.txt'
if (Test-Path $overrideFile) {
    $line = (Get-Content $overrideFile -ErrorAction SilentlyContinue |
             Select-Object -First 1)
    if ($line) {
        $approvedNorm = $line.Replace('\', '/').Trim().ToLower()
        if ($norm -eq $approvedNorm) {
            # Consume the override (one-time use) and allow
            Remove-Item $overrideFile -Force -ErrorAction SilentlyContinue
            exit 0
        }
    }
}

# ── Block — instruct Claude to request permission ────────────────────────────
$msg  = "SCOPE GATE: '$norm' is outside the marketing module.`n`n"
$msg += "Steps to get permission:`n"
$msg += "1. Tell the user exactly what you want to modify in '$norm' and why.`n"
$msg += "2. Ask: 'Do you approve modifying ``$norm``?'`n"
$msg += "3. Wait for the user's explicit confirmation.`n"
$msg += "4. If approved, use the Write tool to write this exact line to ``.claude\scope-override.txt``:`n"
$msg += "   $norm`n"
$msg += "5. Retry your original edit — the gate will allow it once and clear the file."
Write-Output $msg
exit 2
