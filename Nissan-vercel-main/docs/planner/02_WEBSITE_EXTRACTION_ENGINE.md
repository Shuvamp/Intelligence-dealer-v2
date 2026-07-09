Implement Phase 2.

Objective:

Build a production-grade Website Extraction Engine.

Create a dedicated LangGraph called:

WebsiteExtractionGraph

The graph must contain independent nodes:

- URL Validator
- Crawler
- HTML Downloader
- HTML Parser
- Metadata Parser
- Navigation Parser
- Product Extractor
- Service Extractor
- Contact Extractor
- Technology Detector
- Blog Detector
- FAQ Detector
- Media Detector
- Trust Detector
- JSON Builder
- Validator

The final output must ONLY be one normalized JSON.

Extract:

- Website
- Company
- Contact
- Products
- Services
- Pages
- Images
- Videos
- Blog
- FAQ
- Technology
- Technical SEO Information
- Trust Information

Do NOT calculate SEO.

Do NOT calculate AEO.

Return only validated JSON.