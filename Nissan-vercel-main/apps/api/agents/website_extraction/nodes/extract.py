"""Website Extraction — extract stage: product, service, contact extractors.

All heuristic and best-effort: this is heading/regex/JSON-LD pattern matching
over already-parsed HTML (see parse.py), not a guarantee of completeness.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from ..state import WebsiteExtractionState

EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")
PHONE_RE = re.compile(r"\+?\d[\d\-\s()]{7,}\d")

_MAX_ITEMS = 30

_SOCIAL_DOMAINS = {
    "facebook.com": "facebook",
    "instagram.com": "instagram",
    "linkedin.com": "linkedin",
    "twitter.com": "twitter",
    "x.com": "twitter",
    "youtube.com": "youtube",
    "tiktok.com": "tiktok",
}


def _pages_of_type(state: WebsiteExtractionState, page_type: str) -> list[str]:
    return [p["url"] for p in state.get("pages", []) if p.get("type") == page_type]


def _extract_named_items(state: WebsiteExtractionState, page_type: str) -> list[dict]:
    parsed_pages = state.get("parsed_pages", {})
    items: list[dict] = []
    for url in _pages_of_type(state, page_type):
        page = parsed_pages.get(url)
        if not page:
            continue
        for block in page["heading_blocks"]:
            items.append({
                "name": block["heading"],
                "description": block["text"] or None,
                "source_url": url,
            })
            if len(items) >= _MAX_ITEMS:
                return items
    return items


def product_extractor_node(state: WebsiteExtractionState) -> dict:
    if not state.get("parsed_pages"):
        return {}
    return {"products": _extract_named_items(state, "products")}


def service_extractor_node(state: WebsiteExtractionState) -> dict:
    if not state.get("parsed_pages"):
        return {}
    return {"services": _extract_named_items(state, "services")}


def contact_extractor_node(state: WebsiteExtractionState) -> dict:
    parsed_pages = state.get("parsed_pages", {})
    if not parsed_pages:
        return {}

    emails: set[str] = set()
    phones: set[str] = set()
    addresses: set[str] = set()
    social_links: dict[str, str] = {}

    for page in parsed_pages.values():
        emails.update(m.lower() for m in EMAIL_RE.findall(page["text"]))
        phones.update(m.strip() for m in PHONE_RE.findall(page["text"]))

        for link in page["links"]:
            href = link["href"]
            if href.startswith("mailto:"):
                emails.add(href[len("mailto:"):].split("?")[0].lower())
            elif href.startswith("tel:"):
                phones.add(href[len("tel:"):].strip())
            else:
                host = (urlsplit(href).hostname or "").lower().removeprefix("www.")
                platform = _SOCIAL_DOMAINS.get(host)
                if platform and platform not in social_links:
                    social_links[platform] = href

        for entry in page["json_ld"]:
            address = entry.get("address")
            if isinstance(address, dict) and address.get("@type", "").endswith("PostalAddress"):
                parts = [
                    address.get("streetAddress"), address.get("addressLocality"),
                    address.get("addressRegion"), address.get("postalCode"),
                    address.get("addressCountry"),
                ]
                formatted = ", ".join(p for p in parts if p)
                if formatted:
                    addresses.add(formatted)

    return {
        "contact": {
            "emails": sorted(emails)[:_MAX_ITEMS],
            "phones": sorted(phones)[:_MAX_ITEMS],
            "addresses": sorted(addresses)[:_MAX_ITEMS],
            "social_links": social_links,
        }
    }
