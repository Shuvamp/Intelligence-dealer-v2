"""Pure helpers for the Report Generator: the deterministic narrative
templates (the fallback path, and the ONLY path in dev since there's no Groq
key), the deterministic structured-section assembly, and the Markdown
renderer. Every function here is a pure function over plain dicts — no I/O,
no LangGraph state — directly unit-testable.

Nothing here fabricates a verdict where there's no signal: missing fields
degrade to "Unknown"/empty, mirroring company_summary's deterministic
philosophy.
"""
from __future__ import annotations

from typing import Any

# The 11 spec section headings, in spec order — used by render_markdown and
# asserted by tests. Kept as a module constant so the heading text has one
# source of truth.
SECTION_HEADINGS = [
    "Executive Summary",
    "Company Overview",
    "Website Summary",
    "SEO Summary",
    "AEO Summary",
    "Overall Score",
    "Strengths",
    "Weaknesses",
    "Priority Fixes",
    "Technical Details",
    "Recommendations",
]


def grade_for(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def _u(value: Any) -> str:
    """"Unknown" for anything missing/blank, never invented."""
    return value.strip() if isinstance(value, str) and value.strip() else "Unknown"


def company_name_of(website_json: dict, company_summary: dict | None) -> str:
    if company_summary and (company_summary.get("company_name") or "").strip():
        return company_summary["company_name"].strip()
    name = ((website_json.get("company") or {}).get("name") or "").strip()
    return name or "This company"


def website_url_of(website_json: dict) -> str | None:
    website = website_json.get("website") or {}
    return website.get("final_url") or website.get("url")


# ── Narrative templates (deterministic fallback / dev path) ──────────────────

def deterministic_narratives(
    website_json: dict,
    recommendation_report_data: dict,
    seo_analysis_data: dict,
    aeo_analysis_data: dict,
    company_summary: dict | None,
) -> dict[str, str]:
    company = company_name_of(website_json, company_summary)

    return {
        "executive_summary": _executive_summary(company, recommendation_report_data),
        "company_overview": _company_overview(company, website_json, company_summary),
        "website_summary": _website_summary(website_json),
        "seo_summary": _seo_summary(seo_analysis_data),
        "aeo_summary": _aeo_summary(aeo_analysis_data),
    }


def _executive_summary(company: str, rec_data: dict) -> str:
    summary = rec_data.get("summary") or {}
    combined = summary.get("combined_score", 0)
    grade = summary.get("combined_grade", "F")
    seo = summary.get("seo_score", 0)
    aeo = summary.get("aeo_score", 0)
    total = summary.get("total_count", 0)
    critical = summary.get("critical_count", 0)
    high = summary.get("high_count", 0)

    groups = rec_data.get("groups") or {}
    top = [
        r.get("problem", "")
        for r in ([*(groups.get("critical") or []), *(groups.get("high") or [])])[:3]
        if r.get("problem")
    ]

    text = (
        f"{company} scores {combined}/100 (grade {grade}) for combined search visibility — "
        f"SEO {seo}/100 and AEO {aeo}/100. The analysis surfaced {total} issue(s): "
        f"{critical} critical and {high} high priority. "
    )
    if top:
        text += "Top priorities: " + "; ".join(top) + "."
    else:
        text += "No critical or high-priority issues were found."
    return text


def _company_overview(company: str, website_json: dict, company_summary: dict | None) -> str:
    if company_summary:
        industry = _u(company_summary.get("industry"))
        region = _u(company_summary.get("region"))
        description = _u(company_summary.get("description"))
        verdict = (company_summary.get("verdict") or "").strip()
        products = [p for p in (company_summary.get("products") or []) if p and p != "Unknown"]
        services = [s for s in (company_summary.get("services") or []) if s and s != "Unknown"]
    else:
        company_block = website_json.get("company") or {}
        industry = _u(company_block.get("industry"))
        region = _u(company_block.get("region"))
        description = _u(company_block.get("description"))
        verdict = ""
        products = [p.get("name") for p in (website_json.get("products") or []) if p.get("name")]
        services = [s.get("name") for s in (website_json.get("services") or []) if s.get("name")]

    text = f"{company} operates in the {industry} industry"
    text += f", based in {region}. " if region != "Unknown" else ". "
    if description != "Unknown":
        text += description + " "
    if verdict:
        text += verdict + " "
    if products:
        text += "Products include: " + ", ".join(products[:10]) + ". "
    if services:
        text += "Services include: " + ", ".join(services[:10]) + ". "
    return text.strip()


def _website_summary(website_json: dict) -> str:
    website = website_json.get("website") or {}
    pages = len(website.get("pages_crawled") or [])
    products = len(website_json.get("products") or [])
    services = len(website_json.get("services") or [])
    blog = website_json.get("blog") or {}
    faq = len(website_json.get("faq") or [])
    contact = website_json.get("contact") or {}
    has_email = bool(contact.get("emails"))
    has_phone = bool(contact.get("phones"))
    social = contact.get("social_links") or {}
    has_social = any(social.values())

    text = f"The crawl captured {pages} page(s), {products} product(s), and {services} service(s). "
    if blog.get("has_blog"):
        text += f"A blog with {blog.get('post_count', 0)} post(s) was detected. "
    else:
        text += "No blog was detected. "
    text += f"{faq} FAQ entry/entries were found. "

    channels = []
    if has_email:
        channels.append("email")
    if has_phone:
        channels.append("phone")
    if has_social:
        channels.append("social media links")
    if channels:
        text += "Contact channels present: " + ", ".join(channels) + "."
    else:
        text += "No direct contact channels were detected."
    return text


# seo_summary / aeo_summary read as friendly, actionable advice spoken to the
# owner (not a stats recap) — matching the Groq prompt, so the on-screen "AI
# advice" panel stays consistent whether or not a key is configured.

def _seo_summary(seo_data: dict) -> str:
    dims = seo_data.get("dimensions") or []
    fails = [d.get("dimension") for d in dims if d.get("status") == "FAIL"]
    warns = [d.get("dimension") for d in dims if d.get("status") == "WARNING"]
    focus = [d for d in (fails + warns) if d][:5]

    if not focus:
        return (
            "Your website's SEO is in great shape — search engines can find, read, and rank "
            "your pages well. Keep publishing fresh, relevant content and you'll stay ahead."
        )
    return (
        "To help more customers find you on Google, focus on these areas next: "
        + ", ".join(focus)
        + ". Tightening these up will make your site easier to discover and rank higher in search results."
    )


def _aeo_summary(aeo_data: dict) -> str:
    weaknesses = aeo_data.get("weaknesses") or []
    weak_agents = [wk.get("agent") for wk in weaknesses if wk.get("agent")][:5]

    if not weak_agents:
        return (
            "Great news — AI assistants like ChatGPT and Google's AI Overviews can already "
            "understand and recommend your business clearly. Keep your content structured and "
            "factual to stay AI-friendly."
        )
    return (
        "To get recommended more often by AI assistants (ChatGPT, Perplexity, Google AI), work on: "
        + ", ".join(weak_agents)
        + ". Adding clear structured data, a solid FAQ, and factual descriptions helps AI confidently "
        "describe and suggest your business."
    )


# ── Structured-section assembly (always deterministic) ───────────────────────

def assemble_strengths(seo_data: dict, aeo_data: dict) -> list[dict]:
    items: list[dict] = []
    for s in aeo_data.get("strengths") or []:
        items.append({"source": "aeo", "title": s.get("agent", ""), "detail": s.get("note", "")})
    for d in seo_data.get("dimensions") or []:
        if d.get("status") == "PASS":
            items.append({"source": "seo", "title": d.get("dimension", ""), "detail": "Passed all checks."})
    return items


def assemble_weaknesses(seo_data: dict, aeo_data: dict) -> list[dict]:
    items: list[dict] = []
    for wk in aeo_data.get("weaknesses") or []:
        recs = wk.get("recommendations") or []
        detail = recs[0].get("why_ai_may_fail", "") if recs else "Needs attention."
        items.append({"source": "aeo", "title": wk.get("agent", ""), "detail": detail})
    for d in seo_data.get("dimensions") or []:
        if d.get("status") in ("FAIL", "WARNING"):
            recs = d.get("recommendations") or []
            detail = recs[0].get("problem", "") if recs else "Needs attention."
            items.append({"source": "seo", "title": d.get("dimension", ""), "detail": detail})
    return items


def extract_priority_fixes(rec_data: dict) -> list[dict]:
    groups = rec_data.get("groups") or {}
    return [*(groups.get("critical") or []), *(groups.get("high") or [])]


def assemble_technical_details(website_json: dict) -> dict:
    seo = website_json.get("technical_seo") or {}
    tech = website_json.get("technology") or {}
    trust = website_json.get("trust") or {}
    website = website_json.get("website") or {}
    return {
        "has_sitemap": bool(seo.get("has_sitemap")),
        "has_robots_txt": bool(seo.get("has_robots_txt")),
        "has_ssl": bool(trust.get("has_ssl")),
        "has_privacy_policy": bool(trust.get("has_privacy_policy")),
        "has_terms": bool(trust.get("has_terms")),
        "meta_title": seo.get("meta_title"),
        "meta_description": seo.get("meta_description"),
        "schema_markup_types": seo.get("schema_markup_types") or [],
        "cms": tech.get("cms"),
        "ecommerce_platform": tech.get("ecommerce_platform"),
        "frameworks": tech.get("frameworks") or [],
        "analytics": tech.get("analytics") or [],
        "pages_crawled_count": len(website.get("pages_crawled") or []),
    }


# ── Markdown rendering (stored artifact) ─────────────────────────────────────

def _md_escape(text: str) -> str:
    return (text or "").replace("|", "\\|").replace("\n", " ").strip()


def _rec_table(items: list[dict]) -> list[str]:
    if not items:
        return ["_None._"]
    rows = ["| Severity | Category | Problem | Fix | Est. Time |", "|---|---|---|---|---|"]
    for it in items:
        rows.append(
            f"| {it.get('severity', '')} | {_md_escape(it.get('category', ''))} | "
            f"{_md_escape(it.get('problem', ''))} | {_md_escape(it.get('fix', ''))} | "
            f"{_md_escape(it.get('estimated_time', ''))} |"
        )
    return rows


def render_markdown(report_data: dict) -> str:
    meta = report_data.get("meta") or {}
    company = meta.get("company_name") or "Company"
    ov = report_data.get("overall_score") or {}
    lines: list[str] = []

    lines.append(f"# SEO & AEO Report — {company}")
    lines.append("")
    if meta.get("generated_at"):
        lines.append(f"_Generated {meta.get('generated_at')} · engine: {meta.get('engine', 'deterministic')}_")
        lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    lines.append(report_data.get("executive_summary", ""))
    lines.append("")

    lines.append("## Overall Score")
    lines.append("")
    lines.append(f"- **Combined Score:** {ov.get('combined_score')}/100 (Grade {ov.get('combined_grade')})")
    lines.append(f"- **SEO Score:** {ov.get('seo_score')}/100")
    lines.append(f"- **AEO Score:** {ov.get('aeo_score')}/100")
    lines.append("")

    lines.append("## Company Overview")
    lines.append("")
    lines.append(report_data.get("company_overview", ""))
    lines.append("")

    lines.append("## Website Summary")
    lines.append("")
    lines.append(report_data.get("website_summary", ""))
    lines.append("")

    lines.append("## SEO Summary")
    lines.append("")
    lines.append(report_data.get("seo_summary", ""))
    lines.append("")

    lines.append("## AEO Summary")
    lines.append("")
    lines.append(report_data.get("aeo_summary", ""))
    lines.append("")

    lines.append("## Strengths")
    lines.append("")
    strengths = report_data.get("strengths") or []
    if strengths:
        for s in strengths:
            lines.append(f"- **[{str(s.get('source', '')).upper()}] {s.get('title', '')}** — {s.get('detail', '')}")
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## Weaknesses")
    lines.append("")
    weaknesses = report_data.get("weaknesses") or []
    if weaknesses:
        for w in weaknesses:
            lines.append(f"- **[{str(w.get('source', '')).upper()}] {w.get('title', '')}** — {w.get('detail', '')}")
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## Priority Fixes")
    lines.append("")
    lines.extend(_rec_table(report_data.get("priority_fixes") or []))
    lines.append("")

    lines.append("## Technical Details")
    lines.append("")
    td = report_data.get("technical_details") or {}
    lines.append(f"- **Pages crawled:** {td.get('pages_crawled_count', 0)}")
    lines.append(f"- **HTTPS/SSL:** {'yes' if td.get('has_ssl') else 'no'}")
    lines.append(f"- **Sitemap:** {'yes' if td.get('has_sitemap') else 'no'}")
    lines.append(f"- **robots.txt:** {'yes' if td.get('has_robots_txt') else 'no'}")
    lines.append(f"- **Privacy policy:** {'yes' if td.get('has_privacy_policy') else 'no'}")
    lines.append(f"- **Terms:** {'yes' if td.get('has_terms') else 'no'}")
    lines.append(f"- **Meta title:** {td.get('meta_title') or 'Unknown'}")
    lines.append(f"- **Meta description:** {td.get('meta_description') or 'Unknown'}")
    lines.append(f"- **Schema markup types:** {', '.join(td.get('schema_markup_types') or []) or 'none'}")
    lines.append(f"- **CMS:** {td.get('cms') or 'Unknown'}")
    lines.append(f"- **Frameworks:** {', '.join(td.get('frameworks') or []) or 'none'}")
    lines.append(f"- **Analytics:** {', '.join(td.get('analytics') or []) or 'none'}")
    lines.append("")

    lines.append("## Recommendations")
    lines.append("")
    lines.extend(_rec_table(report_data.get("recommendations") or []))
    lines.append("")

    return "\n".join(lines)
