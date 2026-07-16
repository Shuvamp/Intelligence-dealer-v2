"""SEO Agent — links_media analyzers: Internal Links, External Links,
Images, Videos.

Internal Links and External Links always return WARNING —
WebsiteExtractionResult has no link-graph field at all (ParsedPage.links
exists only transiently inside Phase 2's internal crawl state and is never
persisted into extraction_data), so there is zero signal to check.
"""
from __future__ import annotations

from ._common import always_warning, rec, result


def analyze_internal_links(extraction: dict) -> dict:
    return always_warning(
        "Internal Links",
        "Internal link structure cannot be assessed",
        "No internal link graph is captured by the website extraction — page-to-page links exist only "
        "transiently during crawling and are not persisted into the extraction JSON.",
        "Capturing an internal link graph in the extraction pipeline would be needed to assess internal "
        "linking depth and structure.",
    )


def analyze_external_links(extraction: dict) -> dict:
    return always_warning(
        "External Links",
        "External link profile cannot be assessed",
        "Outbound links, their nofollow/dofollow status, and broken-link checks are not captured by the "
        "website extraction.",
        "Capturing outbound links in the extraction pipeline would be needed to assess external linking "
        "quality and detect broken links.",
    )


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
