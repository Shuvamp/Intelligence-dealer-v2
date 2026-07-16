"""AEO Agent — all 11 analyzer functions plus the 3 bookkeeping nodes
(load_extraction, aggregate_and_build, validator), in one file.

Each analyzer is a pure function `(extraction: dict) -> dict` — no I/O, no
LangGraph state — directly unit-testable, mirroring seo_agent's node split.
Given only 11 analyzers (vs Phase 4's 24), this codebase's own precedent
(each seo_agent nodes/*.py file holds 4-6 analyzers at 100-195 lines) puts
11 + 3 bookkeeping nodes comfortably in one ~350-450 line file rather than a
nodes/ package with near-empty theme files.

Signal tiers (docs/planner/05_AEO_AGENT.md, per the approved plan):
strong: Entity Detection, Question Detection, FAQ Analysis, Schema Analysis,
Trust Analysis, Brand Context. weak/caveated: Answer Quality, AI
Readability, Content Chunking, LLM Readability. pure fallback: Citation
Analysis (no citations/sources field exists anywhere in the Phase 2 JSON).
"""
from __future__ import annotations

from pydantic import ValidationError

from ._common import agent_result_key, always_warning, build_node, rec, result, worst
from .schema import AGENT_NAMES, AEOAnalysisResult

_MIN_SNIPPET_LEN = 40
_MAX_SNIPPET_LEN = 300
_MIN_ANSWER_LEN = 40


def analyze_entity_detection(extraction: dict) -> dict:
    company = extraction.get("company") or {}
    name = company.get("name")
    has_products_or_services = bool(extraction.get("products")) or bool(extraction.get("services"))

    if not name and not has_products_or_services:
        return result("Entity Detection", "FAIL", [rec(
            "AI search engines cannot identify what entity or offerings this site represents",
            "No company/brand name and no named products or services were found anywhere in the crawl.",
            "high",
        )])

    if not name or not has_products_or_services:
        missing = "a company/brand name" if not name else "any named products or services"
        return result("Entity Detection", "WARNING", [rec(
            f"AI search engines can only partially identify this entity — {missing} is missing",
            "A clear brand identity AND named offerings are both needed for an AI to confidently cite this business.",
            "medium",
        )])

    return result("Entity Detection", "PASS")


def analyze_question_detection(extraction: dict) -> dict:
    faq = extraction.get("faq") or []
    questions = [f for f in faq if (f.get("question") or "").strip().endswith("?")]

    if not questions:
        return result("Question Detection", "FAIL", [rec(
            "AI search engines have no question-shaped content to match against user queries",
            "No FAQ entries phrased as questions were found on the crawled pages.",
            "high",
        )])

    if len(questions) < 3:
        return result("Question Detection", "WARNING", [rec(
            f"Only {len(questions)} question(s) were detected, limiting how many user queries this site can directly answer",
            "Add more FAQ-style questions covering the range of things customers actually ask.",
            "medium",
        )])

    return result("Question Detection", "PASS")


def analyze_answer_quality(extraction: dict) -> dict:
    faq = extraction.get("faq") or []
    caveat = rec(
        "Answer substance was estimated only by length, not verified for accuracy",
        "This checks that answers are long enough to be substantive; it does not verify factual correctness.",
        "low",
    )

    if not faq:
        return result("Answer Quality", "FAIL", [rec(
            "There are no answers at all for an AI to extract and cite",
            "No FAQ entries were found in the crawl.",
            "high",
        )])

    substantial = [f for f in faq if len((f.get("answer") or "").strip()) >= _MIN_ANSWER_LEN]
    if not substantial:
        return result("Answer Quality", "FAIL", [rec(
            "Existing answers are too short to be useful to an AI search engine",
            f"None of the {len(faq)} FAQ answer(s) reach {_MIN_ANSWER_LEN} characters.",
            "high",
        )])

    if len(substantial) < len(faq):
        return result("Answer Quality", "WARNING", [rec(
            f"Only {len(substantial)}/{len(faq)} FAQ answers are substantial enough to confidently cite",
            "Some answers are too brief for an AI to extract a useful response from.",
            "medium",
        ), caveat])

    return result("Answer Quality", "PASS", [caveat])


def analyze_faq_analysis(extraction: dict) -> dict:
    faq = extraction.get("faq") or []
    schema_sourced = any(f.get("source") == "schema" for f in faq)

    if len(faq) >= 3 and schema_sourced:
        return result("FAQ Analysis", "PASS")

    recommendations = []
    if not faq:
        recommendations.append(rec(
            "AI crawlers have no FAQ content to parse and surface in answers",
            "No FAQ section was detected anywhere on the crawled pages.",
            "high",
        ))
    elif len(faq) < 3:
        recommendations.append(rec(
            f"Only {len(faq)} FAQ entry/entries were found, limiting AI-answerable topics",
            "Expand the FAQ with more common customer questions.",
            "medium",
        ))
    if faq and not schema_sourced:
        recommendations.append(rec(
            "FAQ content is not machine-readable as structured data",
            "FAQ text was detected in page content but not marked up as schema.org FAQPage, making it harder "
            "for AI crawlers to parse reliably.",
            "medium",
        ))

    return result("FAQ Analysis", "WARNING", recommendations)


def analyze_citation_analysis(extraction: dict) -> dict:
    return always_warning(
        "Citation Analysis",
        "Whether AI search engines already cite this site cannot be assessed",
        "This requires citation/mention tracking across AI answer engines (e.g. ChatGPT, Perplexity, "
        "Google AI Overviews), which is outside the scope of static website extraction.",
    )


def analyze_schema_analysis(extraction: dict) -> dict:
    seo = extraction.get("technical_seo") or {}
    types = set(seo.get("schema_markup_types") or [])
    faq = extraction.get("faq") or []
    products = extraction.get("products") or []
    blog = extraction.get("blog") or {}

    expected_types: set[str] = set()
    if faq:
        expected_types.add("FAQPage")
    if products:
        expected_types.add("Product")
    if bool(blog.get("has_blog")) and (blog.get("post_count") or 0) > 0:
        expected_types.add("Article")

    has_org_type = bool(types & {"Organization", "LocalBusiness"})

    if not types:
        return result("Schema Analysis", "FAIL", [rec(
            "AI crawlers have no structured data to reliably parse this site's content and identity",
            "No JSON-LD or microdata schema.org markup was detected on any crawled page.",
            "high",
        )])

    missing = {t for t in expected_types if t not in types}
    if not has_org_type:
        missing.add("Organization or LocalBusiness")

    if missing:
        return result("Schema Analysis", "WARNING", [rec(
            f"Missing schema types that AI answer engines look for: {', '.join(sorted(missing))}",
            "Structured data was found but doesn't cover all AI-relevant content types present on the site.",
            "medium",
        )])

    return result("Schema Analysis", "PASS")


def analyze_ai_readability(extraction: dict) -> dict:
    seo = extraction.get("technical_seo") or {}
    pages = extraction.get("pages") or []
    has_title = bool(seo.get("meta_title"))
    has_description = bool(seo.get("meta_description"))
    titled_pages = [p for p in pages if (p.get("title") or "").strip()]
    title_pct = (len(titled_pages) / len(pages)) if pages else 0.0

    caveat = rec(
        "This checks structural readability signals only, not actual AI comprehension of the content",
        "Meta tags and page titles are a proxy for machine-parseability; they don't guarantee an AI can "
        "correctly summarize or answer questions about the content.",
        "low",
    )

    if not has_title and not has_description:
        return result("AI Readability", "FAIL", [rec(
            "AI crawlers lack basic structural signals to understand what each page is about",
            "No meta title or meta description was found.",
            "high",
        )])

    if not has_title or not has_description or title_pct < 0.7:
        missing = []
        if not has_title:
            missing.append("meta title")
        if not has_description:
            missing.append("meta description")
        if title_pct < 0.7:
            missing.append(f"page titles on {len(titled_pages)}/{len(pages)} crawled pages")
        return result("AI Readability", "WARNING", [rec(
            f"Structural readability is incomplete: {', '.join(missing)}",
            "Fill in the missing structural signals so AI crawlers can parse every page confidently.",
            "medium",
        ), caveat])

    return result("AI Readability", "PASS", [caveat])


def analyze_content_chunking(extraction: dict) -> dict:
    pages = extraction.get("pages") or []
    faq = extraction.get("faq") or []
    blog = extraction.get("blog") or {}

    page_types = {p.get("type") for p in pages if p.get("type") and p.get("type") != "other"}
    unit_count = len(page_types) + (1 if faq else 0) + (1 if (blog.get("post_count") or 0) > 0 else 0)

    caveat = rec(
        "Chunking was estimated at the page/FAQ/blog level, not verified at the paragraph level",
        "This counts distinct page sections, FAQ entries, and blog posts as a proxy for discrete "
        "AI-retrievable content units; it does not inspect paragraph- or passage-level chunking.",
        "low",
    )

    if unit_count <= 1:
        return result("Content Chunking", "FAIL", [rec(
            "Content is not broken into discrete units an AI can retrieve and cite individually",
            "The crawl found essentially one undifferentiated block of content.",
            "high",
        )])

    if unit_count < 3:
        return result("Content Chunking", "WARNING", [rec(
            f"Only {unit_count} distinct content unit(s) were found, limiting what an AI can retrieve piecemeal",
            "Add more distinct sections, FAQ entries, or blog posts so content can be chunked and cited "
            "independently.",
            "medium",
        ), caveat])

    return result("Content Chunking", "PASS", [caveat])


def analyze_trust_analysis(extraction: dict) -> dict:
    trust = extraction.get("trust") or {}
    has_ssl = trust.get("has_ssl", False)
    has_privacy = trust.get("has_privacy_policy", False)
    has_terms = trust.get("has_terms", False)
    certifications = trust.get("certifications") or []
    testimonials_count = trust.get("testimonials_count", 0)

    if not has_ssl or (not has_privacy and not has_terms):
        missing = []
        if not has_ssl:
            missing.append("SSL/HTTPS")
        if not has_privacy and not has_terms:
            missing.append("privacy policy and terms of service")
        return result("Trust Analysis", "FAIL", [rec(
            f"AI answer engines are unlikely to cite a site missing baseline trust signals: {', '.join(missing)}",
            "These are baseline credibility requirements AI answer engines weigh before citing a source.",
            "high",
        )])

    recommendations = []
    status = "PASS"

    if not (has_privacy and has_terms):
        missing_page = "terms of service" if not has_terms else "privacy policy"
        recommendations.append(rec(
            f"Missing {missing_page} reduces citation-worthiness in the eyes of an AI answer engine",
            "Only one of the two standard legal pages was found.",
            "medium",
        ))
        status = "WARNING"

    if not certifications and testimonials_count == 0:
        recommendations.append(rec(
            "No social proof was found to reinforce this site as a trustworthy citation source",
            "No certifications and no testimonials/reviews were detected.",
            "medium",
        ))
        status = "WARNING"

    return result("Trust Analysis", status, recommendations)


def analyze_llm_readability(extraction: dict) -> dict:
    faq = extraction.get("faq") or []
    company = extraction.get("company") or {}
    texts = [f.get("answer") or "" for f in faq]
    if company.get("description"):
        texts.append(company["description"])
    texts = [t.strip() for t in texts if t and t.strip()]

    if not texts:
        return result("LLM Readability", "FAIL", [rec(
            "There is no free text at all for an LLM to extract as a citable snippet",
            "No FAQ answers or company description were found in the crawl.",
            "high",
        )])

    in_band = [t for t in texts if _MIN_SNIPPET_LEN <= len(t) <= _MAX_SNIPPET_LEN]
    frac = len(in_band) / len(texts)
    caveat = rec(
        "Extractability was estimated by text length only, not by actual LLM snippet extraction",
        f"This checks what fraction of free text falls within a {_MIN_SNIPPET_LEN}-{_MAX_SNIPPET_LEN} "
        "character band typical of extractable answer snippets; it does not run an LLM to verify extraction.",
        "low",
    )

    if frac < 0.5:
        return result("LLM Readability", "WARNING", [rec(
            f"Only {len(in_band)}/{len(texts)} text passages fall in a length range LLMs typically extract as snippets",
            "Rewrite overly short or overly long answers/descriptions to a concise, self-contained length.",
            "medium",
        ), caveat])

    return result("LLM Readability", "PASS", [caveat])


def analyze_brand_context(extraction: dict) -> dict:
    company = extraction.get("company") or {}
    name = company.get("name")
    description = company.get("description")
    industry = company.get("industry")
    region = company.get("region")

    if not name:
        return result("Brand Context", "FAIL", [rec(
            "An AI cannot identify or describe this brand at all",
            "No company/brand name was found in the page title, Open Graph tags, or metadata.",
            "high",
        )])

    if not description:
        return result("Brand Context", "WARNING", [rec(
            "An AI can name this brand but cannot describe what it does",
            "A company name was found but no description.",
            "medium",
        )])

    missing = [f for f, v in (("industry", industry), ("region", region)) if not v]
    if missing:
        return result("Brand Context", "WARNING", [rec(
            f"Brand context is incomplete: missing {' and '.join(missing)}",
            "A name and description were found but some profile fields are missing, limiting how "
            "specifically an AI can describe this brand.",
            "low",
        )])

    return result("Brand Context", "PASS")


_ANALYZERS = {
    "Entity Detection": analyze_entity_detection,
    "Question Detection": analyze_question_detection,
    "Answer Quality": analyze_answer_quality,
    "FAQ Analysis": analyze_faq_analysis,
    "Citation Analysis": analyze_citation_analysis,
    "Schema Analysis": analyze_schema_analysis,
    "AI Readability": analyze_ai_readability,
    "Content Chunking": analyze_content_chunking,
    "Trust Analysis": analyze_trust_analysis,
    "LLM Readability": analyze_llm_readability,
    "Brand Context": analyze_brand_context,
}

_SCORE_POINTS = {"PASS": 2, "WARNING": 1, "FAIL": 0}
_MAX_POINTS_PER_AGENT = 2


def load_extraction_node(state: dict) -> dict:
    if not state.get("extraction_data"):
        return {"status": "failed", "errors": [*state.get("errors", []), "extraction_data missing or empty"]}
    return {}


def aggregate_and_build_node(state: dict) -> dict:
    if state.get("status") == "failed":
        return {}  # load_extraction_node already rejected this run

    agents = []
    strengths = []
    weaknesses = []
    pass_count = warning_count = fail_count = 0
    points = 0

    for name in AGENT_NAMES:
        key = agent_result_key(name)
        agent_result = state.get(key) or {"agent": name, "status": "FAIL", "recommendations": []}
        agents.append(agent_result)

        status = agent_result.get("status", "FAIL")
        points += _SCORE_POINTS.get(status, 0)
        recommendations = agent_result.get("recommendations") or []

        if status == "PASS":
            pass_count += 1
            note = recommendations[0]["why_ai_may_fail"] if recommendations else f"{name} passed all checks."
            strengths.append({"agent": name, "note": note})
        else:
            if status == "WARNING":
                warning_count += 1
            else:
                fail_count += 1
            weaknesses.append({"agent": name, "recommendations": recommendations})

    aeo_score = round(100 * points / (_MAX_POINTS_PER_AGENT * len(AGENT_NAMES)))

    analysis_data = {
        "agents": agents,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "summary": {
            "pass_count": pass_count,
            "warning_count": warning_count,
            "fail_count": fail_count,
            "aeo_score": aeo_score,
        },
    }
    return {"analysis_data": analysis_data, "overall_score": aeo_score, "status": "ready"}


def validator_node(state: dict) -> dict:
    data = state.get("analysis_data")
    if not data:
        return {}  # already failed upstream — nothing to validate
    try:
        AEOAnalysisResult.model_validate(data)
    except ValidationError as exc:
        return {
            "status": "failed",
            "errors": [*state.get("errors", []), f"schema_validation_failed: {exc}"],
        }
    return {}


__all__ = [
    "_ANALYZERS",
    "load_extraction_node",
    "aggregate_and_build_node",
    "validator_node",
]
