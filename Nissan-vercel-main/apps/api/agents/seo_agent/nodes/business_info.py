"""SEO Agent — business_info analyzers: Website Information, Company
Information, Contact Information, Products, Services.

Every analyzer here is a pure function (extraction dict) -> SeoDimensionResult
dict — no I/O, no LangGraph state — directly unit-testable.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from ._common import rec, result

_MIN_DESCRIPTION_LEN = 20


def analyze_website_information(extraction: dict) -> dict:
    website = extraction.get("website") or {}
    pages_crawled = website.get("pages_crawled") or []
    domain = website.get("domain")

    if not pages_crawled or not domain:
        return result("Website Information", "FAIL", [rec(
            "No pages were successfully crawled" if not pages_crawled else "Website domain could not be determined",
            "The extraction produced no crawlable pages or no resolvable domain, so no website-level analysis is possible.",
            "Re-run the website extraction and verify the seed URL is reachable.",
            "high", "high", "medium",
        )])

    recommendations = []
    status = "PASS"

    if len(pages_crawled) < 3:
        recommendations.append(rec(
            "Shallow crawl — fewer than 3 pages were captured",
            f"Only {len(pages_crawled)} page(s) were crawled, limiting the depth of this analysis.",
            "Ensure the site has a discoverable sitemap.xml or clear internal navigation so more pages can be crawled.",
            "medium", "medium", "low",
        ))
        status = "WARNING"

    final_url = website.get("final_url")
    normalized_url = website.get("normalized_url")
    if final_url and normalized_url:
        if (urlsplit(final_url).hostname or "") != (urlsplit(normalized_url).hostname or ""):
            recommendations.append(rec(
                "The site redirects to a different domain",
                f"The seed URL {normalized_url} redirects to {final_url}, a different host.",
                "Confirm this redirect is intentional (e.g. a canonical domain) and not a misconfiguration.",
                "medium", "medium", "low",
            ))
            status = "WARNING"

    return result("Website Information", status, recommendations)


def analyze_company_information(extraction: dict) -> dict:
    company = extraction.get("company") or {}
    name = company.get("name")
    description = company.get("description")
    industry = company.get("industry")

    if not name:
        return result("Company Information", "FAIL", [rec(
            "Company name could not be determined",
            "No company/site name was found in the page title, Open Graph tags, or metadata.",
            "Add a clear site title and an og:site_name meta tag to the homepage.",
            "high", "high", "low",
        )])

    missing = [field for field, value in (("description", description), ("industry", industry)) if not value]
    if missing:
        return result("Company Information", "WARNING", [rec(
            f"Missing {' and '.join(missing)}",
            "A company name was found but some profile fields are missing.",
            "Add a meta description and clarify the business's industry/category on the homepage.",
            "medium", "medium", "low",
        )])

    return result("Company Information", "PASS")


def analyze_contact_information(extraction: dict) -> dict:
    contact = extraction.get("contact") or {}
    emails = contact.get("emails") or []
    phones = contact.get("phones") or []
    addresses = contact.get("addresses") or []
    social_links = contact.get("social_links") or {}
    has_social = any(v for v in social_links.values())

    if not emails and not phones:
        return result("Contact Information", "FAIL", [rec(
            "No email or phone number found",
            "Customers have no direct way to contact the business from the crawled pages.",
            "Add a visible email address and phone number, ideally on a dedicated Contact page.",
            "high", "high", "low",
        )])

    recommendations = []
    status = "PASS"

    if not emails or not phones:
        recommendations.append(rec(
            f"Missing {'email address' if not emails else 'phone number'}",
            "Only one contact channel was found on the crawled pages.",
            "Provide both an email address and a phone number for redundancy.",
            "medium", "medium", "low",
        ))
        status = "WARNING"

    if not addresses:
        recommendations.append(rec(
            "No physical address found",
            "No address was detected in page content or structured data.",
            "Add a physical business address — this is especially important for local SEO.",
            "medium", "medium", "low",
        ))
        status = "WARNING"

    if not has_social:
        recommendations.append(rec(
            "No social media links found",
            "No links to Facebook, Instagram, LinkedIn, Twitter/X, YouTube, or TikTok were detected.",
            "Add links to active social media profiles to build trust and authority.",
            "low", "low", "low",
        ))
        status = "WARNING"

    return result("Contact Information", status, recommendations)


def _described_items(items: list[dict]) -> list[dict]:
    return [i for i in items if len((i.get("description") or "").strip()) >= _MIN_DESCRIPTION_LEN]


def analyze_products(extraction: dict) -> dict:
    products = extraction.get("products") or []
    services = extraction.get("services") or []

    if not products and not services:
        return result("Products", "FAIL", [rec(
            "No products or services were found",
            "The extraction found no product or service listings anywhere on the crawled pages.",
            "Ensure the site has a dedicated products/models page with clear headings and descriptions.",
            "high", "high", "medium",
        )])

    if not products:
        return result("Products", "WARNING", [rec(
            "No products found",
            "Services were found but no distinct products — this may be expected for a service-only business.",
            "If the business does sell products, add a dedicated products/inventory page.",
            "medium", "low", "low",
        )])

    if not _described_items(products):
        return result("Products", "WARNING", [rec(
            "Products found but none have a meaningful description",
            "Product names were detected but no accompanying description text of useful length.",
            "Add a short description (at least a sentence) under each product heading.",
            "medium", "medium", "low",
        )])

    return result("Products", "PASS")


def analyze_services(extraction: dict) -> dict:
    products = extraction.get("products") or []
    services = extraction.get("services") or []

    if not products and not services:
        return result("Services", "FAIL", [rec(
            "No products or services were found",
            "The extraction found no product or service listings anywhere on the crawled pages.",
            "Ensure the site has a dedicated services page with clear headings and descriptions.",
            "high", "high", "medium",
        )])

    if not services:
        return result("Services", "WARNING", [rec(
            "No services found",
            "Products were found but no distinct services — this may be expected for a product-only business.",
            "If the business does offer services, add a dedicated services page.",
            "medium", "low", "low",
        )])

    if not _described_items(services):
        return result("Services", "WARNING", [rec(
            "Services found but none have a meaningful description",
            "Service names were detected but no accompanying description text of useful length.",
            "Add a short description (at least a sentence) under each service heading.",
            "medium", "medium", "low",
        )])

    return result("Services", "PASS")
