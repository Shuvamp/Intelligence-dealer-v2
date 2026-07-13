"""Website Extraction — parse stage: html_parser, metadata_parser, navigation_parser."""
from __future__ import annotations

import json
import logging
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from ..state import ParsedPage, WebsiteExtractionState
from .fetch import _same_scope

logger = logging.getLogger(__name__)

_WHITESPACE_RE = re.compile(r"\s+")
_MAX_TEXT_EXCERPT_CHARS = 2000
_MAX_HEADINGS_PER_PAGE = 20
_MAX_LINK_ENTRIES = 150

# Shared page-type taxonomy — also used by extract.py to locate the
# products/services pages to mine.
PAGE_TYPE_KEYWORDS: dict[str, list[str]] = {
    "about": ["about"],
    "contact": ["contact"],
    "products": ["product", "model", "inventory", "vehicle"],
    "services": ["service", "maintenance", "finance", "financing"],
    "blog": ["blog", "news", "insight"],
    "faq": ["faq", "frequently-asked", "frequently asked"],
}


def classify_page(url: str, link_text: str = "") -> str:
    path = urlsplit(url).path.lower()
    text = (link_text or "").lower()
    if path in ("", "/"):
        return "home"
    for category, keywords in PAGE_TYPE_KEYWORDS.items():
        if any(kw in path or kw in text for kw in keywords):
            return category
    return "other"


def _parse_one(url: str, html: str) -> ParsedPage:
    soup = BeautifulSoup(html, "lxml")

    title = soup.title.get_text(strip=True) if soup.title else None

    meta: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("name") or tag.get("property")
        content = tag.get("content")
        if key and content:
            meta[key.lower()] = content

    canonical_tag = soup.find("link", rel=lambda v: v and "canonical" in v)
    canonical = canonical_tag.get("href") if canonical_tag else None
    if canonical:
        canonical = urljoin(url, canonical)

    headings = [
        h.get_text(strip=True)
        for h in soup.find_all(["h1", "h2", "h3"])
        if h.get_text(strip=True)
    ]

    # Keep mailto:/tel: hrefs here (contact_extractor_node depends on them) —
    # only crawl-target discovery (fetch.py's _discover_nav_links) excludes
    # non-crawlable schemes; this cache is shared by every downstream node.
    links: list[dict[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:")):
            continue
        if href.startswith(("mailto:", "tel:")):
            links.append({"href": href, "text": a.get_text(strip=True)})
            continue
        links.append({"href": urljoin(url, href), "text": a.get_text(strip=True)})

    json_ld: list[dict] = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        if isinstance(data, list):
            json_ld.extend(d for d in data if isinstance(d, dict))
        elif isinstance(data, dict):
            json_ld.append(data)

    text = _WHITESPACE_RE.sub(" ", soup.get_text(separator=" ")).strip()
    heading_blocks = _heading_blocks(soup)

    return ParsedPage(
        url=url, title=title, meta=meta, canonical=canonical,
        headings=headings, links=links, json_ld=json_ld, text=text,
        heading_blocks=heading_blocks,
    )


def _heading_blocks(soup: BeautifulSoup) -> list[dict[str, str]]:
    """Pairs each h2/h3/h4 with the text of its immediately-following <p>
    sibling(s) — a best-effort heuristic for "heading + description" card
    layouts, reused by product/service/FAQ extraction. Stops at the first
    non-<p> sibling (another heading, a link cluster, a nav block, ...)
    rather than vacuuming up unrelated trailing content."""
    blocks: list[dict[str, str]] = []
    for heading in soup.find_all(["h2", "h3", "h4"]):
        heading_text = heading.get_text(strip=True)
        if not heading_text:
            continue
        parts: list[str] = []
        for sibling in heading.find_next_siblings():
            if getattr(sibling, "name", None) != "p":
                break
            text = sibling.get_text(" ", strip=True)
            if text:
                parts.append(text)
            if sum(len(p) for p in parts) > 500:
                break
        blocks.append({"heading": heading_text, "text": " ".join(parts)[:500]})
    return blocks


def html_parser_node(state: WebsiteExtractionState) -> dict:
    raw_html = state.get("raw_html", {})
    if not raw_html:
        return {}

    parsed_pages: dict[str, ParsedPage] = {}
    errors = list(state.get("errors", []))
    for url, html in raw_html.items():
        try:
            parsed_pages[url] = _parse_one(url, html)
        except Exception as exc:  # noqa: BLE001
            logger.exception("website_extraction.html_parse_failed url=%s", url)
            errors.append(f"parse_failed: {url}: {exc}")

    return {"parsed_pages": parsed_pages, "errors": errors}


def _primary_page(state: WebsiteExtractionState) -> ParsedPage | None:
    """The homepage (or wherever the seed URL ended up) — the source for
    company-level metadata."""
    parsed = state.get("parsed_pages", {})
    for candidate in (state.get("final_url"), state.get("seed_url")):
        if candidate and candidate in parsed:
            return parsed[candidate]
    return next(iter(parsed.values()), None)


def metadata_parser_node(state: WebsiteExtractionState) -> dict:
    page = _primary_page(state)
    if not page:
        return {}

    meta = page["meta"]
    og_tags = {k: v for k, v in meta.items() if k.startswith("og:")}
    meta_title = meta.get("title") or page["title"]
    meta_description = meta.get("description") or og_tags.get("og:description")

    company_name = og_tags.get("og:site_name") or og_tags.get("og:title") or page["title"]
    company_description = meta_description

    return {
        "company": {
            "name": company_name,
            "description": company_description,
            "region": None,
            "industry": None,
        },
        "technical_seo": {
            **state.get("technical_seo", {}),
            "meta_title": meta_title,
            "meta_description": meta_description,
            "canonical_url": page["canonical"],
            "og_tags": og_tags,
        },
    }


def navigation_parser_node(state: WebsiteExtractionState) -> dict:
    parsed_pages = state.get("parsed_pages", {})
    if not parsed_pages:
        return {}

    primary = _primary_page(state)
    link_text_by_url: dict[str, str] = {}
    if primary:
        for link in primary["links"]:
            link_text_by_url.setdefault(link["href"], link["text"])

    pages = [
        {
            "url": url,
            "title": page["title"],
            "type": classify_page(url, link_text_by_url.get(url, "")),
            "text_excerpt": page["text"][:_MAX_TEXT_EXCERPT_CHARS] or None,
            "headings": page["headings"][:_MAX_HEADINGS_PER_PAGE],
        }
        for url, page in parsed_pages.items()
    ]
    return {"pages": pages}


def link_graph_node(state: WebsiteExtractionState) -> dict:
    """Classifies every link collected across crawled pages as internal/
    external (deduped by href, mailto:/tel: excluded — those are contact
    info, already handled by contact_extractor_node). internal_count/
    external_count are true unique totals; the internal/external lists are
    capped samples for downstream rule/LLM checks, not the real count."""
    parsed_pages = state.get("parsed_pages", {})
    seed_host = state.get("seed_host")
    if not parsed_pages or not seed_host:
        return {}

    internal_by_href: dict[str, dict] = {}
    external_by_href: dict[str, dict] = {}

    for source_url, page in parsed_pages.items():
        for link in page["links"]:
            href = link["href"]
            if href.startswith(("mailto:", "tel:")):
                continue
            host = urlsplit(href).hostname
            if not host:
                continue
            bucket = internal_by_href if _same_scope(host, seed_host) else external_by_href
            bucket.setdefault(href, {"href": href, "text": link.get("text") or None, "source_page": source_url})

    return {
        "links": {
            "internal_count": len(internal_by_href),
            "external_count": len(external_by_href),
            "internal": list(internal_by_href.values())[:_MAX_LINK_ENTRIES],
            "external": list(external_by_href.values())[:_MAX_LINK_ENTRIES],
        }
    }
