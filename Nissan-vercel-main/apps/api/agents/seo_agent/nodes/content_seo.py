"""SEO Agent — content_seo analyzers: Page Analysis, Content Analysis,
Keyword Analysis, Blog, FAQ, Accessibility.

Keyword Analysis always returns WARNING (no search-volume/ranking data
exists anywhere in the Phase 2 JSON). Content Analysis and Accessibility use
weak-but-real signals and always attach a caveat explaining the check is
partial, even on a PASS.
"""
from __future__ import annotations

from ._common import always_warning, rec, result, worst

_MIN_DESCRIPTION_LEN = 20


def analyze_page_analysis(extraction: dict) -> dict:
    pages = extraction.get("pages") or []
    if not pages:
        return result("Page Analysis", "FAIL", [rec(
            "No pages were analyzed", "No page records were found in the extraction.",
            "Re-run the website extraction and confirm the crawl succeeds.", "high", "high", "medium",
        )])

    titled = [p for p in pages if (p.get("title") or "").strip()]
    types = {p.get("type") for p in pages if p.get("type") and p.get("type") != "other"}
    title_pct = len(titled) / len(pages)

    recommendations = []
    status = "PASS"

    if title_pct < 0.3:
        recommendations.append(rec(
            "Most pages are missing a title",
            f"Only {len(titled)}/{len(pages)} crawled pages have a <title>.",
            "Add a unique, descriptive title tag to every page.", "high", "high", "low",
        ))
        status = "FAIL"
    elif title_pct < 0.7:
        recommendations.append(rec(
            "Some pages are missing a title",
            f"{len(titled)}/{len(pages)} crawled pages have a title.",
            "Add title tags to the remaining pages.", "medium", "medium", "low",
        ))
        status = worst([status, "WARNING"])

    if len(pages) > 3 and len(types) < 2:
        recommendations.append(rec(
            "Low page-type diversity",
            "Crawled pages could not be classified into distinct sections (e.g. about, contact, products).",
            "Structure site navigation with clear, distinct sections.", "low", "low", "low",
        ))
        status = worst([status, "WARNING"])

    return result("Page Analysis", status, recommendations)


def analyze_content_analysis(extraction: dict) -> dict:
    products = extraction.get("products") or []
    services = extraction.get("services") or []
    blog = extraction.get("blog") or {}
    faq = extraction.get("faq") or []

    described_count = sum(
        1 for item in (products + services)
        if len((item.get("description") or "").strip()) >= _MIN_DESCRIPTION_LEN
    )
    has_blog_content = bool(blog.get("has_blog")) and (blog.get("post_count") or 0) > 0
    has_faq = len(faq) > 0

    if described_count == 0 and not has_blog_content and not has_faq:
        return result("Content Analysis", "FAIL", [rec(
            "No meaningful textual content found",
            "No product/service descriptions, blog posts, or FAQ entries were detected.",
            "Add descriptive content: product/service details, a blog, or an FAQ section.",
            "high", "high", "medium",
        )])

    caveat = rec(
        "Content depth assessed via presence only",
        "This check counts described products/services, blog posts, and FAQ entries as a proxy for "
        "content depth; it does not assess writing quality, uniqueness, or keyword targeting.",
        "For a full content audit, review readability, originality, and keyword coverage manually or "
        "with a dedicated tool.", "low", "low", "low",
    )

    if described_count < 3 and not has_blog_content and not has_faq:
        return result("Content Analysis", "WARNING", [rec(
            "Limited content depth",
            f"Only {described_count} described item(s) were found, with no blog or FAQ content.",
            "Expand product/service descriptions or add a blog/FAQ section.", "medium", "medium", "medium",
        ), caveat])

    return result("Content Analysis", "PASS", [caveat])


def analyze_keyword_analysis(extraction: dict) -> dict:
    return always_warning(
        "Keyword Analysis",
        "Keyword targeting cannot be assessed",
        "This requires search-volume and ranking data (e.g. Google Search Console, SEMrush, Ahrefs), "
        "which is outside the scope of static website extraction.",
        "Connect a keyword research/rank-tracking tool to identify target keywords and measure performance.",
    )


def analyze_blog(extraction: dict) -> dict:
    blog = extraction.get("blog") or {}
    has_blog = blog.get("has_blog", False)
    post_count = blog.get("post_count", 0)

    if not has_blog:
        return result("Blog", "WARNING", [rec(
            "No blog detected", "The site does not appear to have a blog or news section.",
            "Consider adding a blog to publish fresh, relevant content regularly.", "medium", "low", "medium",
        )])

    if post_count < 3:
        return result("Blog", "WARNING", [rec(
            "Blog appears thin or inactive", f"Only {post_count} post(s) were detected.",
            "Publish more posts regularly to build topical authority.", "medium", "medium", "medium",
        )])

    return result("Blog", "PASS")


def analyze_faq(extraction: dict) -> dict:
    faq = extraction.get("faq") or []

    if not faq:
        return result("FAQ", "WARNING", [rec(
            "No FAQ section detected", "No frequently-asked-questions content was found.",
            "Add an FAQ section addressing common customer questions.", "medium", "low", "low",
        )])

    schema_sourced = any(f.get("source") == "schema" for f in faq)
    if len(faq) >= 3 and schema_sourced:
        return result("FAQ", "PASS")

    recommendations = []
    if len(faq) < 3:
        recommendations.append(rec(
            "FAQ section is thin", f"Only {len(faq)} FAQ entry/entries were detected.",
            "Expand the FAQ with more common customer questions.", "low", "low", "low",
        ))
    if not schema_sourced:
        recommendations.append(rec(
            "FAQ has no structured data markup",
            "FAQ content was detected in page text but not marked up as schema.org FAQPage.",
            "Add FAQPage schema markup so search engines can show rich FAQ results.", "medium", "medium", "medium",
        ))
    return result("FAQ", "WARNING", recommendations)


def analyze_accessibility(extraction: dict) -> dict:
    images = extraction.get("images") or []
    if not images:
        return result("Accessibility", "WARNING", [rec(
            "No images to assess alt-text coverage",
            "The crawl found no images, so alt-text coverage cannot be measured.",
            "A full accessibility audit (ARIA roles, color contrast, keyboard navigation) requires a "
            "dedicated tool regardless.", "medium", "low", "high",
        )])

    with_alt = [i for i in images if (i.get("alt") or "").strip()]
    pct = len(with_alt) / len(images)
    caveat = rec(
        "Only image alt-text coverage was checked",
        "This is a partial accessibility signal; full WCAG compliance (contrast, ARIA, keyboard "
        "navigation) was not assessed.",
        "Run a dedicated accessibility audit (e.g. axe, WAVE, Lighthouse Accessibility) for a complete "
        "assessment.", "low", "low", "medium",
    )

    if pct < 0.5:
        return result("Accessibility", "FAIL", [rec(
            "Most images are missing alt text", f"Only {len(with_alt)}/{len(images)} images have alt text.",
            "Add descriptive alt text to all meaningful images.", "high", "high", "low",
        ), caveat])
    if pct < 0.9:
        return result("Accessibility", "WARNING", [rec(
            "Some images are missing alt text", f"{len(with_alt)}/{len(images)} images have alt text.",
            "Add alt text to the remaining images.", "medium", "medium", "low",
        ), caveat])
    return result("Accessibility", "PASS", [caveat])
