"""SEO Agent — links_media analyzers: Internal Links, External Links,
Images, Videos.

Internal Links and External Links are real rule-based checks over
extraction["links"] (link_graph_node, website_extraction/nodes/parse.py) —
deduped internal/external hrefs collected during crawl. Broken-link
detection is explicitly out of scope (would require an unbounded number of
third-party HTTP requests) — flagged as a caveat, not silently skipped.
"""
from __future__ import annotations

from ._common import rec, result

_GENERIC_ANCHOR_TEXTS = {"click here", "read more", "learn more", "here", "more", "link", "this page", "see more"}
_MIN_LINK_DENSITY = 2.0
_MAX_GENERIC_RATIO = 0.5
_MAX_EXTERNAL_TO_INTERNAL_RATIO = 1.5


def analyze_internal_links(extraction: dict) -> dict:
    links = extraction.get("links") or {}
    internal_count = links.get("internal_count", 0)
    internal_sample = links.get("internal") or []

    if internal_count == 0:
        return result("Internal Links", "FAIL", [rec(
            "No internal links found", "The crawl found zero links pointing to other pages on this site.",
            "Add navigation and in-content links connecting pages across the site.", "high", "high", "low",
        )])

    pages_crawled = (extraction.get("website") or {}).get("pages_crawled") or []
    pages_count = max(len(pages_crawled), 1)
    density = internal_count / pages_count

    generic = [l for l in internal_sample if (l.get("text") or "").strip().lower() in _GENERIC_ANCHOR_TEXTS]
    generic_ratio = (len(generic) / len(internal_sample)) if internal_sample else 0.0

    recommendations = []
    status = "PASS"

    if density < _MIN_LINK_DENSITY:
        recommendations.append(rec(
            "Low internal link density", f"Average of {density:.1f} internal links per crawled page.",
            "Add more contextual internal links between related pages (products, services, blog posts).",
            "medium", "medium", "low",
        ))
        status = "WARNING"

    if generic_ratio > _MAX_GENERIC_RATIO:
        recommendations.append(rec(
            "Many internal links use generic anchor text",
            f"{len(generic)}/{len(internal_sample)} sampled links use non-descriptive text like "
            '"click here" or "read more".',
            "Use descriptive, keyword-relevant anchor text instead of generic phrases.", "low", "low", "low",
        ))
        status = "WARNING"

    return result("Internal Links", status, recommendations)


def analyze_external_links(extraction: dict) -> dict:
    links = extraction.get("links") or {}
    internal_count = links.get("internal_count", 0)
    external_count = links.get("external_count", 0)

    caveat = rec(
        "Only link presence and internal:external balance were checked",
        "Broken-link liveness and nofollow/dofollow status were not assessed — checking every outbound "
        "link would require an unbounded number of third-party HTTP requests.",
        "Run a dedicated link-checker tool (e.g. Screaming Frog, Ahrefs Site Audit) for broken-link "
        "detection.", "low", "low", "low",
    )

    if external_count == 0:
        return result("External Links", "WARNING", [rec(
            "No external links found", "The crawl found no links pointing to other domains.",
            "A small number of relevant outbound links (e.g. to manufacturer or partner sites) can "
            "support credibility; this is a minor signal.", "low", "low", "low",
        ), caveat])

    ratio = external_count / max(internal_count, 1)
    if ratio > _MAX_EXTERNAL_TO_INTERNAL_RATIO:
        return result("External Links", "WARNING", [rec(
            "External links substantially outnumber internal links",
            f"{external_count} external vs {internal_count} internal links — an unusually external-heavy "
            "link profile.",
            "Review outbound links; prioritize internal linking to keep visitors and link equity on-site.",
            "low", "low", "low",
        ), caveat])

    return result("External Links", "PASS", [caveat])


def analyze_images(extraction: dict) -> dict:
    images = extraction.get("images") or []
    if not images:
        return result("Images", "FAIL", [rec(
            "No images found", "The crawl detected no images on any crawled page.",
            "Add relevant images to showcase products, services, and the business.", "medium", "medium", "low",
        )])

    pages_crawled = (extraction.get("website") or {}).get("pages_crawled") or []
    pages_count = max(len(pages_crawled), 1)
    avg_per_page = len(images) / pages_count

    if avg_per_page < 1:
        return result("Images", "WARNING", [rec(
            "Low image coverage", f"Average of {avg_per_page:.1f} images per crawled page.",
            "Add more relevant images across key pages.", "low", "low", "low",
        )])

    return result("Images", "PASS")


def analyze_videos(extraction: dict) -> dict:
    videos = extraction.get("videos") or []
    if not videos:
        return result("Videos", "WARNING", [rec(
            "No videos found", "No embedded videos (YouTube, Vimeo, etc.) were detected.",
            "Consider adding product demos or testimonial videos to increase engagement.",
            "low", "low", "medium",
        )])
    return result("Videos", "PASS")
