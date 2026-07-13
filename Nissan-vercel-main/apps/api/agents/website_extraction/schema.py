"""Pydantic models for the ONE normalized JSON this agent produces (per
docs/planner/02_WEBSITE_EXTRACTION_ENGINE.md: "final output must ONLY be one
normalized JSON"). Used by validator_node (nodes/build.py) to validate the
JSON Builder's assembled dict, and as the API's response_model for the
`extraction_data` field.

Unlike every other agent in this codebase, this one has no dedicated schema
file precedent — justified here because the literal deliverable of this
phase IS a validated JSON contract (the spec's own "Validator" node needs
something concrete to validate against).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PageType = Literal["home", "about", "contact", "products", "services", "blog", "faq", "other"]
VideoPlatform = Literal["youtube", "vimeo", "other"]
FaqSource = Literal["schema", "heading_fallback"]


class WebsiteInfo(BaseModel):
    url: str
    normalized_url: str
    final_url: Optional[str] = None
    domain: Optional[str] = None
    pages_crawled: list[str] = Field(default_factory=list)
    pages_discovered_count: int = 0
    crawl_started_at: Optional[str] = None
    crawl_completed_at: Optional[str] = None
    crawl_duration_ms: Optional[int] = None


class CompanyInfo(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    region: Optional[str] = None
    industry: Optional[str] = None


class SocialLinks(BaseModel):
    facebook: Optional[str] = None
    instagram: Optional[str] = None
    linkedin: Optional[str] = None
    twitter: Optional[str] = None
    youtube: Optional[str] = None
    tiktok: Optional[str] = None


class ContactInfo(BaseModel):
    emails: list[str] = Field(default_factory=list)
    phones: list[str] = Field(default_factory=list)
    addresses: list[str] = Field(default_factory=list)
    social_links: SocialLinks = Field(default_factory=SocialLinks)


class ProductOrService(BaseModel):
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None


class PageInfo(BaseModel):
    url: str
    title: Optional[str] = None
    type: PageType = "other"
    text_excerpt: Optional[str] = None
    headings: list[str] = Field(default_factory=list)


class ImageInfo(BaseModel):
    url: str
    alt: Optional[str] = None
    source_page: Optional[str] = None


class VideoInfo(BaseModel):
    url: str
    platform: VideoPlatform = "other"
    source_page: Optional[str] = None


class BlogPost(BaseModel):
    title: str
    url: str


class BlogInfo(BaseModel):
    has_blog: bool = False
    post_count: int = 0
    recent_posts: list[BlogPost] = Field(default_factory=list)


class FaqEntry(BaseModel):
    question: str
    answer: str
    source: FaqSource = "heading_fallback"


class TechnologyInfo(BaseModel):
    cms: Optional[str] = None
    ecommerce_platform: Optional[str] = None
    analytics: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    raw_signals: list[str] = Field(default_factory=list)


class TechnicalSeoInfo(BaseModel):
    has_sitemap: bool = False
    has_robots_txt: bool = False
    robots_txt_respected: bool = True
    sitemap_used: bool = False
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    canonical_url: Optional[str] = None
    og_tags: dict[str, str] = Field(default_factory=dict)
    schema_markup_types: list[str] = Field(default_factory=list)


class TrustInfo(BaseModel):
    has_ssl: bool = False
    has_privacy_policy: bool = False
    has_terms: bool = False
    certifications: list[str] = Field(default_factory=list)
    testimonials_count: int = 0


class LinkEntry(BaseModel):
    href: str
    text: Optional[str] = None
    source_page: Optional[str] = None


class LinksInfo(BaseModel):
    """internal_count/external_count are true unique-href totals; the
    internal/external lists are capped samples (see link_graph_node) purely
    to bound storage/token size, not the real count."""
    internal_count: int = 0
    external_count: int = 0
    internal: list[LinkEntry] = Field(default_factory=list)
    external: list[LinkEntry] = Field(default_factory=list)


class WebsiteExtractionResult(BaseModel):
    """The ONE normalized JSON — the agent's entire literal deliverable."""
    website: WebsiteInfo
    company: CompanyInfo = Field(default_factory=CompanyInfo)
    contact: ContactInfo = Field(default_factory=ContactInfo)
    products: list[ProductOrService] = Field(default_factory=list)
    services: list[ProductOrService] = Field(default_factory=list)
    pages: list[PageInfo] = Field(default_factory=list)
    images: list[ImageInfo] = Field(default_factory=list)
    videos: list[VideoInfo] = Field(default_factory=list)
    blog: BlogInfo = Field(default_factory=BlogInfo)
    faq: list[FaqEntry] = Field(default_factory=list)
    technology: TechnologyInfo = Field(default_factory=TechnologyInfo)
    technical_seo: TechnicalSeoInfo = Field(default_factory=TechnicalSeoInfo)
    trust: TrustInfo = Field(default_factory=TrustInfo)
    links: LinksInfo = Field(default_factory=LinksInfo)
