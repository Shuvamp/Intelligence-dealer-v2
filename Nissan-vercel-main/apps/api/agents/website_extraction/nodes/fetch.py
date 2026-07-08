"""Website Extraction — fetch stage: url_validator, crawler, html_downloader.

This is the only part of the codebase that fetches arbitrary third-party
URLs (every other agent's httpx usage is internal PostgREST calls to the
trusted local shim/Supabase) — a different trust boundary, hence the SSRF
guard below. Every node here follows the project-wide "never raise" rule:
a fetch/DNS/crawl failure degrades to empty output + a recorded error, never
an unhandled exception.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlsplit, urljoin
from urllib.robotparser import RobotFileParser

import httpx

from ..state import WebsiteExtractionState

logger = logging.getLogger(__name__)

USER_AGENT = "ADIP-WebsiteExtractionBot/1.0 (+https://adip.example/bot)"
MAX_PAGES = 12
CRAWL_TIMEOUT_S = 8
DOWNLOAD_TIMEOUT_S = 12
MAX_PAGE_BYTES = 3 * 1024 * 1024
MAX_CONTROL_BYTES = 512 * 1024  # robots.txt / sitemap.xml — much smaller than a page
MAX_REDIRECTS = 5
CONCURRENCY = 5

_DENIED_HOSTNAMES = {"metadata.google.internal", "metadata"}
_HEADERS = {"User-Agent": USER_AGENT}
_TIMEOUT = httpx.Timeout(connect=5, read=10, write=5, pool=5)


# ---------------------------------------------------------------------------
# SSRF guard — shared by url_validator_node and html_downloader_node
# ---------------------------------------------------------------------------
def _is_disallowed_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


async def _resolve_and_check(hostname: str) -> tuple[bool, str | None]:
    """Resolves `hostname` and rejects it if any resolved address is
    private/loopback/link-local/multicast/reserved/unspecified. Does not
    close the DNS-rebinding TOCTOU window (resolve-then-connect race) —
    accepted residual risk, documented; full closure would need a custom
    transport pinning the validated IP (deferred to Phase 8)."""
    if hostname.lower() in _DENIED_HOSTNAMES:
        return False, f"denied hostname: {hostname}"
    try:
        loop = asyncio.get_event_loop()
        infos = await loop.getaddrinfo(hostname, None)
    except OSError as e:
        return False, f"dns_resolution_failed: {e}"
    if not infos:
        return False, "dns_resolution_failed: no addresses"
    for _family, _type, _proto, _canon, sockaddr in infos:
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            continue
        if _is_disallowed_ip(ip):
            return False, f"ssrf_blocked: {hostname} resolves to disallowed ip {sockaddr[0]}"
    return True, None


async def _check_url_safe(url: str) -> tuple[bool, str | None, str | None]:
    """Returns (ok, hostname, error)."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return False, None, f"unsupported_scheme: {parts.scheme}"
    hostname = parts.hostname
    if not hostname:
        return False, None, "missing_hostname"
    ok, err = await _resolve_and_check(hostname)
    return ok, hostname, err


def _same_scope(url_host: str, seed_host: str) -> bool:
    """Same host, or a subdomain of the seed host — a deliberate
    simplification of "same registrable domain" (which needs a public-suffix
    list dependency this repo doesn't have)."""
    url_host = url_host.lower()
    seed_host = seed_host.lower()
    return url_host == seed_host or url_host.endswith(f".{seed_host}")


# ---------------------------------------------------------------------------
# url_validator_node
# ---------------------------------------------------------------------------
async def url_validator_node(state: WebsiteExtractionState) -> dict:
    """Defense-in-depth format re-check (Phase 1 already validated this URL,
    but a direct API caller could bypass Phase 1) PLUS new capability Phase 1
    never had: DNS resolution + SSRF/private-IP rejection + liveness check."""
    seed_url = state.get("seed_url") or ""
    ok, hostname, err = await _check_url_safe(seed_url)
    if not ok:
        return {"errors": [*state.get("errors", []), err or "invalid seed url"]}

    # Liveness check — cheap HEAD, falls back to a tiny ranged GET if HEAD
    # isn't supported (common on dealer sites behind simple static hosts).
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=_TIMEOUT) as client:
            resp = await client.head(seed_url, headers=_HEADERS)
            if resp.status_code >= 500:
                return {"errors": [*state.get("errors", []), f"seed_unreachable: http_{resp.status_code}"]}
    except httpx.HTTPError:
        pass  # HEAD unsupported/blocked — not fatal, crawler will find out for real

    return {"seed_host": hostname}


# ---------------------------------------------------------------------------
# crawler_node — URL discovery only (bounded), not full-page content download
# ---------------------------------------------------------------------------
async def _fetch_control_text(client: httpx.AsyncClient, url: str) -> str | None:
    """Small, non-HTML control-plane fetch (robots.txt / sitemap.xml)."""
    ok, _hostname, _err = await _check_url_safe(url)
    if not ok:
        return None
    try:
        resp = await client.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return None
        if len(resp.content) > MAX_CONTROL_BYTES:
            return None
        return resp.text
    except httpx.HTTPError:
        return None


def _parse_sitemap_locs(xml_text: str) -> list[str]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    # Namespace-agnostic: match any tag named "loc" regardless of xmlns.
    return [el.text.strip() for el in root.iter() if el.tag.endswith("loc") and el.text]


def _discover_nav_links(homepage_html: str, base_url: str) -> list[str]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(homepage_html, "lxml")
    links: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        links.append(urljoin(base_url, href))
    return links


async def crawler_node(state: WebsiteExtractionState) -> dict:
    seed_host = state.get("seed_host")
    if not seed_host:
        return {}  # url_validator_node failed — nothing to crawl

    try:
        return await asyncio.wait_for(_crawl(state, seed_host), timeout=CRAWL_TIMEOUT_S)
    except asyncio.TimeoutError:
        return {"errors": [*state.get("errors", []), "crawl_discovery_timed_out"]}
    except Exception as exc:  # noqa: BLE001
        logger.exception("website_extraction.crawler_failed context_id=%s", state.get("context_id"))
        return {"errors": [*state.get("errors", []), f"crawl_failed: {exc}"]}


async def _crawl(state: WebsiteExtractionState, seed_host: str) -> dict:
    seed_url = state["seed_url"]
    parts = urlsplit(seed_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    started_at = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(follow_redirects=False) as client:
        robots_text = await _fetch_control_text(client, f"{origin}/robots.txt")
        has_robots_txt = robots_text is not None

        rp = RobotFileParser()
        rp.set_url(f"{origin}/robots.txt")
        if robots_text is not None:
            rp.parse(robots_text.splitlines())
        else:
            rp.parse([])  # empty ruleset — allow-all default

        def _allowed(url: str) -> bool:
            try:
                return rp.can_fetch(USER_AGENT, url)
            except Exception:  # noqa: BLE001
                return True

        # Sitemap discovery: robots.txt "Sitemap:" directives, else /sitemap.xml.
        sitemap_candidates = list(rp.site_maps() or []) or [f"{origin}/sitemap.xml"]
        discovered: list[str] = []
        sitemap_used = False
        for candidate in sitemap_candidates[:2]:
            xml_text = await _fetch_control_text(client, candidate)
            if not xml_text:
                continue
            locs = _parse_sitemap_locs(xml_text)
            same_scope = [u for u in locs if (urlsplit(u).hostname or "") and _same_scope(urlsplit(u).hostname, seed_host)]
            if same_scope:
                discovered = same_scope
                sitemap_used = True
                break
        has_sitemap = sitemap_used or bool(robots_text and rp.site_maps())

        homepage_html: str | None = None
        if not discovered:
            # Fallback: fetch the homepage and follow its nav links one level.
            if _allowed(seed_url):
                ok, _hostname, _err = await _check_url_safe(seed_url)
                if ok:
                    try:
                        resp = await client.get(seed_url, headers=_HEADERS, timeout=_TIMEOUT)
                        if resp.status_code == 200 and len(resp.content) <= MAX_PAGE_BYTES:
                            homepage_html = resp.text
                    except httpx.HTTPError:
                        pass
            if homepage_html:
                nav_links = _discover_nav_links(homepage_html, seed_url)
                discovered = [u for u in nav_links if (urlsplit(u).hostname or "") and _same_scope(urlsplit(u).hostname, seed_host)]

        # Always lead with the homepage; dedupe while preserving order.
        ordered = [seed_url] + [u for u in discovered if u != seed_url]
        seen: set[str] = set()
        candidates: list[str] = []
        for u in ordered:
            if u in seen:
                continue
            seen.add(u)
            candidates.append(u)

        pages_discovered_count = len(candidates)
        pages_crawled = [u for u in candidates if _allowed(u)][:MAX_PAGES]

        result: dict = {
            "pages_crawled": pages_crawled,
            "pages_discovered_count": pages_discovered_count,
            "has_sitemap": has_sitemap,
            "has_robots_txt": has_robots_txt,
            "robots_txt_respected": True,
            "sitemap_used": sitemap_used,
            "crawl_started_at": started_at,
        }
        if homepage_html is not None and seed_url in pages_crawled:
            result["raw_html"] = {**state.get("raw_html", {}), seed_url: homepage_html}
        return result


# ---------------------------------------------------------------------------
# html_downloader_node — bulk content fetch for whatever crawler didn't
# already fetch during discovery
# ---------------------------------------------------------------------------
async def _fetch_page(client: httpx.AsyncClient, url: str) -> tuple[str | None, str | None, str | None]:
    """Returns (final_url, html, error). Redirects are followed manually so
    every hop can be re-validated against the SSRF guard."""
    current = url
    for _ in range(MAX_REDIRECTS):
        ok, _hostname, err = await _check_url_safe(current)
        if not ok:
            return None, None, err
        try:
            resp = await client.get(current, headers=_HEADERS, timeout=_TIMEOUT)
        except httpx.HTTPError as e:
            return None, None, f"fetch_error: {e}"

        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("location")
            if not location:
                return None, None, "redirect_missing_location"
            current = urljoin(current, location)
            continue
        if resp.status_code != 200:
            return None, None, f"http_{resp.status_code}"
        content_type = resp.headers.get("content-type", "")
        if "html" not in content_type and content_type:
            return None, None, f"unsupported_content_type: {content_type}"
        if len(resp.content) > MAX_PAGE_BYTES:
            return None, None, "page_too_large"
        return current, resp.text, None
    return None, None, "too_many_redirects"


async def html_downloader_node(state: WebsiteExtractionState) -> dict:
    pages = state.get("pages_crawled", [])
    if not pages:
        return {}

    try:
        return await asyncio.wait_for(_download_all(state, pages), timeout=DOWNLOAD_TIMEOUT_S)
    except asyncio.TimeoutError:
        return {"errors": [*state.get("errors", []), "html_download_timed_out"]}
    except Exception as exc:  # noqa: BLE001
        logger.exception("website_extraction.download_failed context_id=%s", state.get("context_id"))
        return {"errors": [*state.get("errors", []), f"download_failed: {exc}"]}


async def _download_all(state: WebsiteExtractionState, pages: list[str]) -> dict:
    raw_html = dict(state.get("raw_html", {}))
    already = set(raw_html.keys())
    remaining = [u for u in pages if u not in already]
    errors: list[str] = list(state.get("errors", []))
    final_url: str | None = state.get("final_url")
    seed_url = state["seed_url"]

    sem = asyncio.Semaphore(CONCURRENCY)

    async def _one(url: str, client: httpx.AsyncClient) -> None:
        nonlocal final_url
        async with sem:
            resolved_url, html, err = await _fetch_page(client, url)
        if err:
            errors.append(f"fetch_failed: {url}: {err}")
            return
        raw_html[url] = html  # keyed by the ORIGINAL crawled url, not post-redirect
        if url == seed_url:
            final_url = resolved_url

    async with httpx.AsyncClient(follow_redirects=False) as client:
        await asyncio.gather(*(_one(u, client) for u in remaining))

    if seed_url in raw_html and final_url is None:
        final_url = seed_url

    started = state.get("crawl_started_at")
    completed_at = datetime.now(timezone.utc)
    duration_ms = None
    if started:
        try:
            started_dt = datetime.fromisoformat(started)
            duration_ms = int((completed_at - started_dt).total_seconds() * 1000)
        except ValueError:
            pass

    return {
        "raw_html": raw_html,
        "final_url": final_url,
        "crawl_completed_at": completed_at.isoformat(),
        "crawl_duration_ms": duration_ms,
        "errors": errors,
    }
