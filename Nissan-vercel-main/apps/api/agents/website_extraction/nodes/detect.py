"""Website Extraction — detect stage: technology, blog, faq, media, trust.

All heuristic/best-effort signature matching, not exhaustive detection.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from ..state import WebsiteExtractionState

_MAX_ITEMS = 20

# ---------------------------------------------------------------------------
# technology_detector_node
# ---------------------------------------------------------------------------
_CMS_SIGNATURES = {
    "wp-content": "WordPress", "wp-includes": "WordPress",
    "cdn.shopify.com": "Shopify",
    "static.wixstatic.com": "Wix",
    "cdn.squarespace.com": "Squarespace",
    "/sites/default/files": "Drupal",
}
_ECOMMERCE_SIGNATURES = {"cdn.shopify.com": "Shopify"}
_ANALYTICS_SIGNATURES = {
    "googletagmanager.com": "Google Tag Manager", "gtag(": "Google Analytics",
    "connect.facebook.net": "Meta Pixel", "hotjar": "Hotjar", "clarity.ms": "Microsoft Clarity",
}
_FRAMEWORK_SIGNATURES = {
    "__next_data__": "Next.js", "_next/static": "Next.js",
    "__nuxt__": "Nuxt", "ng-version": "Angular",
}


def technology_detector_node(state: WebsiteExtractionState) -> dict:
    raw_html = state.get("raw_html", {})
    if not raw_html:
        return {}

    combined = "\n".join(raw_html.values()).lower()
    cms = next((name for marker, name in _CMS_SIGNATURES.items() if marker in combined), None)
    ecommerce = next((name for marker, name in _ECOMMERCE_SIGNATURES.items() if marker in combined), None)
    analytics = sorted({name for marker, name in _ANALYTICS_SIGNATURES.items() if marker in combined})
    frameworks = sorted({name for marker, name in _FRAMEWORK_SIGNATURES.items() if marker in combined})
    raw_signals = [
        marker for marker in {**_CMS_SIGNATURES, **_ANALYTICS_SIGNATURES, **_FRAMEWORK_SIGNATURES}
        if marker in combined
    ]

    return {
        "technology": {
            "cms": cms, "ecommerce_platform": ecommerce,
            "analytics": analytics, "frameworks": frameworks, "raw_signals": raw_signals,
        }
    }


# ---------------------------------------------------------------------------
# blog_detector_node
# ---------------------------------------------------------------------------
def blog_detector_node(state: WebsiteExtractionState) -> dict:
    blog_pages = [p["url"] for p in state.get("pages", []) if p.get("type") == "blog"]
    if not blog_pages:
        return {"blog": {"has_blog": False, "post_count": 0, "recent_posts": []}}

    parsed_pages = state.get("parsed_pages", {})
    posts: list[dict] = []
    for url in blog_pages:
        page = parsed_pages.get(url)
        if not page:
            continue
        prefix = urlsplit(url).path
        for link in page["links"]:
            path = urlsplit(link["href"]).path
            if link["text"] and path.startswith(prefix) and path != prefix:
                posts.append({"title": link["text"], "url": link["href"]})
            if len(posts) >= 5:
                break
        if len(posts) >= 5:
            break

    return {"blog": {"has_blog": True, "post_count": len(posts), "recent_posts": posts[:5]}}


# ---------------------------------------------------------------------------
# faq_detector_node
# ---------------------------------------------------------------------------
def faq_detector_node(state: WebsiteExtractionState) -> dict:
    parsed_pages = state.get("parsed_pages", {})
    if not parsed_pages:
        return {}

    faqs: list[dict] = []

    # Primary: schema.org FAQPage JSON-LD.
    for page in parsed_pages.values():
        for entry in page["json_ld"]:
            if str(entry.get("@type", "")).lower() != "faqpage":
                continue
            for item in entry.get("mainEntity", []) or []:
                question = item.get("name")
                answer = (item.get("acceptedAnswer") or {}).get("text")
                if question and answer:
                    faqs.append({"question": question, "answer": answer, "source": "schema"})
                if len(faqs) >= _MAX_ITEMS:
                    return {"faq": faqs}

    # Fallback: heading text ending in "?" paired with its sibling content.
    for page in parsed_pages.values():
        for block in page["heading_blocks"]:
            if block["heading"].strip().endswith("?") and block["text"]:
                faqs.append({"question": block["heading"], "answer": block["text"], "source": "heading_fallback"})
            if len(faqs) >= _MAX_ITEMS:
                return {"faq": faqs}

    return {"faq": faqs}


# ---------------------------------------------------------------------------
# media_detector_node — the one node that re-parses raw HTML directly, since
# <img>/<video>/<iframe> extraction is single-consumer (not reused elsewhere,
# unlike the fields html_parser_node caches onto ParsedPage).
# ---------------------------------------------------------------------------
_VIDEO_PLATFORMS = {"youtube.com": "youtube", "youtu.be": "youtube", "vimeo.com": "vimeo"}


def media_detector_node(state: WebsiteExtractionState) -> dict:
    raw_html = state.get("raw_html", {})
    if not raw_html:
        return {}

    images: list[dict] = []
    videos: list[dict] = []
    seen_images: set[str] = set()
    seen_videos: set[str] = set()

    for url, html in raw_html.items():
        soup = BeautifulSoup(html, "lxml")

        for img in soup.find_all("img", src=True):
            src = img["src"].strip()
            if not src or src in seen_images:
                continue
            seen_images.add(src)
            images.append({"url": src, "alt": img.get("alt"), "source_page": url})
            if len(images) >= 50:
                break

        for tag in soup.find_all(["video", "iframe"]):
            src = (tag.get("src") or "").strip()
            if not src or src in seen_videos:
                continue
            host = urlsplit(src).hostname or ""
            platform = next((p for domain, p in _VIDEO_PLATFORMS.items() if domain in host), None)
            if platform or tag.name == "video":
                seen_videos.add(src)
                videos.append({"url": src, "platform": platform or "other", "source_page": url})

    return {"images": images[:50], "videos": videos}


# ---------------------------------------------------------------------------
# trust_detector_node
# ---------------------------------------------------------------------------
_CERTIFICATION_KEYWORDS = ["iso 9001", "iso 27001", "bbb accredited", "google guaranteed"]


def trust_detector_node(state: WebsiteExtractionState) -> dict:
    parsed_pages = state.get("parsed_pages", {})
    if not parsed_pages:
        return {}

    final_url = state.get("final_url") or state.get("seed_url") or ""
    has_ssl = urlsplit(final_url).scheme == "https"

    has_privacy_policy = False
    has_terms = False
    certifications: set[str] = set()
    testimonials_count = 0

    for page in parsed_pages.values():
        for link in page["links"]:
            haystack = f"{link['href']} {link['text']}".lower()
            if "privacy" in haystack:
                has_privacy_policy = True
            if "terms" in haystack:
                has_terms = True

        lower_text = page["text"].lower()
        for kw in _CERTIFICATION_KEYWORDS:
            if kw in lower_text:
                certifications.add(kw.title())

        for entry in page["json_ld"]:
            entry_type = str(entry.get("@type", "")).lower()
            if "review" in entry_type or "aggregaterating" in entry_type:
                testimonials_count += 1
        testimonials_count += sum(
            1 for b in page["heading_blocks"]
            if "testimonial" in b["heading"].lower() or "review" in b["heading"].lower()
        )

    return {
        "trust": {
            "has_ssl": has_ssl,
            "has_privacy_policy": has_privacy_policy,
            "has_terms": has_terms,
            "certifications": sorted(certifications),
            "testimonials_count": testimonials_count,
        }
    }
