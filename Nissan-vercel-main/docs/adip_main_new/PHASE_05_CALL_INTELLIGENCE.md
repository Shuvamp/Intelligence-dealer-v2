# PHASE 5 — CALL INTELLIGENCE AGENT

## Status

Planned. Scope split agreed: **Phase 5 = Call Intelligence (this doc).**
**Phase 6 = Dynamic Re-Scoring (Sriram)** — see `PHASE_06_DYNAMIC_RESCORING.md`.

Lifecycle position:

```
Validation → Normalization → Scoring → Assignment → Workflow → Follow-up
   → Call Intelligence (Phase 5)  →  Dynamic Re-Scoring (Phase 6)
```

## Objective

Turn a recorded sales call into structured insight and persist it, so the
Dynamic Re-Scoring Agent (Phase 6) can update the lead and re-trigger the
Workflow Agent. Phase 5 **produces the signal**; it does not change the score.

Must support Tamil, Tanglish, and English. Prioritise **low cost, simplicity,
reliability** and the existing "an agent never breaks the platform" rule.

## Scope

**In scope (Phase 5 owns):**
- Audio upload (mp3 / wav / m4a) from the lead detail page
- Local transcription via faster-whisper
- ONE Groq extraction call → sentiment, customer summary, intent, competitors,
  timeline, recommended action
- Persist transcript + sentiment + analysis (4 new tables)
- Async processing, audit trail, failure/retry handling
- UI: upload + per-call status + transcript + analysis card
- **Hand off** to the re-scoring agent via one defined trigger

**Out of scope (Phase 6 / Sriram owns):**
- Mutating `leads.score` / `score_value` / classification
- `lead_score_history` / `score_events` tables
- Triggering the Workflow Agent
- Telephony/streaming (manual upload only in Phase 5; see Future Phase)

## Core principles

1. **No second scoring engine.** Phase 5 never writes a score. It persists
   analysis and fires the handoff; Phase 6 decides the score change.
2. **No second workflow engine.** Workflow Agent stays authoritative; Phase 6
   (not Phase 5) re-triggers it.
3. **No speaker diarization.** The LLM infers customer statements from context.
   Architecture must allow diarization to be added later with no schema change.
4. **Single LLM extraction call.** Sentiment, competitor, intent, follow-up are
   all extracted in one request — not separate calls.

## Architecture

```
Sales exec uploads recording  →  store file  →  call_recordings (status=uploaded)
        │   async (run_in_executor — never blocks the upload request)
        ▼
faster-whisper "small" int8  →  transcript + detected language      [$0, local]
        ▼
ONE Groq extraction call (llama-3.1-8b-instant)                     [free tier]
        ▼
persist  call_transcripts / call_sentiment / call_analysis  (status=completed)
        ▼
HANDOFF  →  POST {RESCORE_URL}/rescore/{lead_id}
            { "trigger_source": "call_intelligence", "call_id": "<uuid>" }
            (fire-and-forget; degrades gracefully if Phase 6 isn't deployed yet)
        ▼
   [Phase 6 — Dynamic Re-Scoring owns everything downstream]
```

## Integration contract with Phase 6  ⚠️ AGREE THIS BEFORE BUILDING

Single seam so Phase 5 and Phase 6 can be built in parallel:

- **Trigger (Phase 5 → Phase 6):**
  `POST {RESCORE_URL}/rescore/{lead_id}` with body
  `{ "trigger_source": "call_intelligence", "call_id": "<uuid>" }`.
  Fire-and-forget, mirroring the existing `triggerWorkflowAgent` /
  `triggerFollowupAgent` pattern.
- **What Phase 6 reads:** the `call_analysis` row keyed by `call_id`
  (sentiment, interest_level, buying_intent_score, competitors,
  competitor_risk, price_sensitivity, purchase_timeline, test_drive_interest,
  followup_requested, recommended_action, reasoning).
- **Phase 5 guarantee:** the `call_analysis` row exists with `status=completed`
  **before** the trigger fires.
- **Resilience:** if the endpoint is missing/down, Phase 5 logs and continues —
  the analysis is still persisted and visible.
- **Config:** `RESCORE_URL` (defaults to FastAPI/shim base), `CALL_AUTO_RESCORE=1`
  toggle (same shape as `AUTO_WORKFLOW`).

## Low-cost stack (marginal cost per call ≈ $0)

- **Transcription:** faster-whisper, model `small`, `device=cpu`,
  `compute_type=int8`. No transcription API. Model behind `WHISPER_MODEL` env
  (prod can bump to `medium`). Needs **ffmpeg** for `m4a` decoding (bake into the
  Docker image — Phase 8). First-run model download (~150–500 MB) into image/volume.

  ```python
  from faster_whisper import WhisperModel
  model = WhisperModel("small", device="cpu", compute_type="int8")
  segments, info = model.transcribe(audio_path)
  ```

- **Extraction:** ONE Groq `llama-3.1-8b-instant` call. Reuse the existing
  failover ladder + `parse_json_safely` + integer clamping from
  `apps/api/agents/scoring/`. Truncate/cap transcript length to stay under
  Groq's free-tier TPM. (Groq primary by design here for cost — different from
  the Claude-primary scoring/follow-up agents; deliberate, documented choice.)

- **Storage:** local disk `apps/api/.uploads/{tenant_id}/{lead_id}/` in dev
  ($0); a Supabase Storage bucket for prod (net-new — signed URLs, size/type/
  duration caps). Same gap that kept Phase 2 Documents a stub — call it out.

## Database tables — migration `0022` + DuckDB shim parity + RLS

(`0020` = WhatsApp, `0021` = lead intake signals; Phase 5 takes `0022`.)
All tenant-scoped with an RLS policy, mirrored into the shim's `initSchema()`.

**call_recordings**
- id, tenant_id, lead_id, uploaded_by, file_name, recording_url,
  duration_seconds, status, created_at
- status: `uploaded | transcribing | analyzing | completed | failed`

**call_transcripts**
- id, tenant_id, call_id, transcript, language_detected, created_at

**call_sentiment**
- id, tenant_id, call_id, sentiment (`positive|neutral|negative`), confidence,
  created_at

**call_analysis**
- id, tenant_id, call_id, customer_summary, interest_level, buying_intent_score,
  competitors, competitor_risk, price_sensitivity, purchase_timeline,
  test_drive_interest, followup_requested, recommended_action, reasoning,
  raw_analysis, created_at

Also: add `'call'` to the `lead_event_type` enum (additive `ALTER TYPE`, same
pattern as Phase 3's `workflow`) for the timeline audit entry.

## LLM extraction

Single Groq call. System prompt instructs the model to (1) infer which
statements are the **customer's** and ignore the sales executive's, then (2)
analyse only those. Return valid JSON only.

Required JSON schema:

```json
{
  "sentiment": "positive|neutral|negative",
  "customer_summary": ["Asked for EMI details", "Comparing with Hyundai Creta"],
  "interest_level": "high|medium|low",
  "buying_intent_score": 85,
  "competitors": ["Hyundai Creta"],
  "competitor_risk": "none|low|medium|high",
  "price_sensitivity": "low|medium|high",
  "purchase_timeline": "immediate|30_days|90_days|unknown",
  "test_drive_interest": true,
  "followup_requested": true,
  "recommended_action": "schedule_test_drive",
  "reasoning": ["Customer requested EMI details", "Compared with Creta"]
}
```

Reuse the competitor keyword list from `agents/scoring/nodes.py`
(`compute_competitive_risk`) so detection is consistent across agents.

Classification vocabularies:
- interest_level: high (booking/EMI/delivery/test-drive questions) · medium
  (evaluating/comparing) · low (passive/unclear)
- purchase_timeline: immediate · 30_days · 90_days · unknown
- competitor_risk: none · low (casual mention) · medium (actively comparing) ·
  high (strongly prefers a competitor)

## API endpoints (FastAPI)

| Endpoint | Purpose |
|---|---|
| `POST /calls/upload` (multipart: `lead_id`, `audio_file`) | Store file + create row + schedule async job → `{call_id, status:"uploaded"}` |
| `POST /calls/{call_id}/analyze` | Manual retry — idempotent, `UPDATE`s the same rows |
| `GET /calls/{call_id}` | Recording + transcript + sentiment + analysis |
| `GET /leads/{lead_id}/calls` | All recordings for a lead |

## Code structure

`apps/api/agents/call_intelligence/` (mirrors `whatsapp/` / `workflow/`):
- `state.py` — job/graph state
- `transcribe.py` — faster-whisper wrapper (run via `run_in_executor`)
- `extract.py` — prompt + Groq call + JSON parse/clamp
- `data.py` — persistence (4 tables + lead_events audit)
- `service.py` — async orchestration + the Phase 6 handoff trigger
- `graph.py` — optional LangGraph: `transcribe → extract → persist → handoff`

Shim: `CREATE TABLE`s + `/calls/*` routes (or proxy to FastAPI).
UI: extend the existing **Call History** section on the lead detail **page**
(now a full page, not a drawer) — uploader + per-call status/transcript + an
**Analysis card** (customer summary, interest, competitors, timeline, price
sensitivity, recommended action). No score-impact line in Phase 5 (that appears
once Phase 6 lands).

## Processing model / errors

- Async, never block the upload request.
- faster-whisper is sync + CPU-bound → **must** run via `run_in_executor`
  (same pattern as `lead_scorer.invoke` / `lead_validator.invoke`), never a bare
  `asyncio.create_task`, or it freezes the event loop.
- Transcription failure → `status=failed`, retryable via the analyze endpoint.
- Analysis failure → keep the transcript, mark for re-analysis.
- Handoff failure → log and continue; never roll back the persisted analysis.
- Upload validation: mime/extension allow-list, max file size, max duration.

## Idempotency

`call_analysis` is keyed by `call_id`; re-analysis **updates** that row rather
than inserting a new one — so a retry never duplicates data, and (because Phase 5
never mutates the score) there is no double-counting risk on this side.

## Audit requirements

Persist and make traceable: upload event, transcription completion, analysis
completion, handoff trigger. (Score change + workflow trigger are audited by
Phase 6.)

## Tests

- `extract.py` JSON parsing + clamping with a mocked LLM (deterministic).
- Upload validation (reject non-audio / oversized / over-duration).
- Handoff trigger fires with the correct payload (mock the HTTP call).
- Transcription path with a mocked whisper model.

## Build order

1. Migration `0022` + shim tables + `lead_event_type` `'call'` value.
2. `transcribe.py` + `extract.py` (mockable, unit-tested).
3. `data.py` + `service.py` (async + handoff, degrades if Phase 6 absent).
4. Endpoints + upload validation + local-disk storage.
5. UI: uploader + Analysis card in Call History.
6. Tests.

## Future phase (not Phase 5)

Telephony integration (Exotel / Knowlarity / MyOperator / Twilio): provider
records call → webhook → ADIP → same processing pipeline. Design the upload/
processing path so a provider webhook can feed it later with no schema change.

## Acceptance criteria

- ✓ Upload works for mp3 / wav / m4a
- ✓ faster-whisper transcription works (Tamil / Tanglish / English)
- ✓ Customer statements identified; sales-exec statements ignored
- ✓ Single Groq extraction call
- ✓ Sentiment / competitor / intent / timeline extracted
- ✓ Results persisted to the 4 tables; analysis visible in the UI
- ✓ Async processing; transcription off the event loop
- ✓ Failure states persisted and retryable
- ✓ Handoff to Phase 6 fires with `{trigger_source:"call_intelligence", call_id}`
- ✓ Audit trail maintained
- ✓ No score mutation, no workflow trigger, no diarization in Phase 5
- ✓ Future telephony webhook supported by the same pipeline
