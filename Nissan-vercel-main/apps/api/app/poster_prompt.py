"""Master prompt for AI poster / banner generation (Gemini 3 image).

Single source of truth — fully dynamic. Every poster prompt is assembled here
from the campaign/event inputs, so tuning the visual style happens in ONE place.

Two modes:
  • create — compose a fresh festive marketing poster around the real car photo.
  • refine — edit an already-generated poster with the user's extra instruction,
             keeping everything else intact.

FORMAT RULE (non-negotiable):
  Instagram Feed — VERTICAL PORTRAIT 4:5 (1080×1350 px). No exceptions.
  Never landscape, square, Reels/Story (9:16), horizontal banner, or hero layout.

MANDATORY 5-ZONE LAYOUT (top → bottom):
  TOP    — Nissan logo + campaign badge
  UPPER  — Headline + supporting text
  CENTER — Large, fully visible vehicle as hero
  LOWER  — Offer details + CTA button/text
  BOTTOM — Disclaimer / T&C fine print
"""
from __future__ import annotations

# House style applied to every generated poster.
BRAND_STYLE = (
    "Brand: Nissan (India dealership). Premium, aspirational, trustworthy automotive "
    "advertising look. Use ₹ for any prices. Photoreal, high-end commercial photography."
)

# Mandatory canvas spec — portrait 4:5 only.
_FORMAT_RULE = (
    "CANVAS: Strict VERTICAL PORTRAIT format — 4:5 aspect ratio (1080×1350 px). "
    "Do NOT generate landscape, square, horizontal banner, Reels/Story (9:16), "
    "or website hero layouts under any circumstances."
)

def _layout_zones(has_logo: bool) -> str:
    """Return the 5-zone layout instruction, with Zone 1 adapted to logo source."""
    zone1 = (
        "ZONE 1 TOP — USE ONLY the logo from the FIRST image provided as input. "
        "Render it EXACTLY as given — preserve every colour, shape, and letter. "
        "Do NOT redesign, recolour, shrink, crop, replace, or in any way alter it. "
        "Do NOT substitute it with any stock Nissan logo, generated emblem, or default branding. "
        "Place it top-left or top-center."
        if has_logo else
        "ZONE 1 TOP — Nissan logo (top-left or top-center) + campaign badge/tagline chip."
    )
    return (
        "LAYOUT — five zones stacked top to bottom, no zone may be omitted:\n"
        f"  {zone1}\n"
        "  ZONE 2 UPPER  — Headline text (large, bold) + 1-line supporting subtext below it.\n"
        "  ZONE 3 CENTER — Hero vehicle: large, fully visible, sharp, dynamically lit. "
        "The car must not be cropped; show the full body including wheels.\n"
        "  ZONE 4 LOWER  — Offer details (price/discount/EMI) + prominent CTA (e.g. 'Book Now', 'Test Drive').\n"
        "  ZONE 5 BOTTOM — Fine-print disclaimer / T&C in small legible text."
    )

# Channel → secondary composition hint (portrait format already enforced above).
_CHANNEL_HINT = {
    "instagram": "Instagram Feed — portrait 4:5 (1080×1350 px), thumb-stopping vertical social creative",
    "facebook":  "Facebook Feed — portrait-first vertical social composition",
    "x":         "X/Twitter — vertical portrait social composition",
    "google_business": "Google Business — clean portrait business-listing creative",
    "whatsapp":  "WhatsApp — portrait mobile-first composition",
}


def festive_scene(theme: str) -> str:
    """Map an occasion/theme to a decorated background scene."""
    t = (theme or "").lower()
    if any(w in t for w in ["diwali", "deepavali", "navratri", "dussehra", "pongal", "sankranti", "ugadi", "onam"]):
        return ("glowing diyas (oil lamps), marigold garlands, rangoli patterns on the floor, "
                "deep maroon drapes, warm golden bokeh lights")
    if any(w in t for w in ["christmas", "new year"]):
        return ("christmas ornaments, pine garlands with warm fairy lights, red velvet drapes, "
                "gift boxes with ribbons, soft snow accents")
    if any(w in t for w in ["eid", "ramadan", "ramzan", "bakrid", "muharram"]):
        return "elegant crescent-and-lantern motifs, emerald and gold accents, soft glowing lanterns"
    if any(w in t for w in ["independence", "republic"]):
        return "subtle saffron-white-green tricolor light accents, confetti, celebratory premium stage"
    if any(w in t for w in ["holi"]):
        return "vibrant colour-powder splashes, playful festive energy, bright daylight"
    if any(w in t for w in ["father", "mother", "family", "children", "valentine"]):
        return "warm family-celebration setting, soft golden light, tasteful ribbons and heart motifs"
    if any(w in t for w in ["monsoon", "rain"]):
        return "fresh monsoon evening, gentle rain streaks and reflections on wet premium tarmac"
    if any(w in t for w in ["summer"]):
        return "bright summer open-road backdrop, clear sky, energetic warm light"
    if any(w in t for w in ["launch", "unveil", "arrival", "new"]):
        return "dramatic product-launch stage, spotlights, dark luxury backdrop, subtle smoke"
    return "premium automotive showroom stage, dramatic spotlights, dark luxury backdrop"


def build_poster_prompt(
    *,
    kind: str = "campaign",
    title: str = "",
    theme: str = "",
    headline: str = "",
    vehicle: str | None = None,
    offer: str | None = None,
    channel: str | None = None,
    has_car_image: bool = False,
    has_logo: bool = False,
    instructions: str | None = None,
    mode: str = "create",
) -> str:
    """Assemble the full Gemini image prompt from the given inputs."""
    instr = (instructions or "").strip()

    # ── refine: edit the attached existing poster ───────────────────────────
    if mode == "refine":
        return (
            "You are editing the attached existing Nissan marketing poster. "
            "Apply ONLY the following change requested by the user, and keep the car, "
            "overall layout, branding, headline and colours otherwise intact:\n"
            f'  "{instr or "improve the overall polish and lighting"}"\n'
            f"{_FORMAT_RULE}\n"
            "Return the complete edited poster in VERTICAL PORTRAIT 4:5 (1080×1350 px), "
            "high resolution, photoreal, spelling any text exactly as shown."
        )

    # ── create: compose a fresh poster ──────────────────────────────────────
    occasion = theme or title or "Nissan campaign"
    big_text = headline or theme or title or "Drive the Difference"
    scene = festive_scene(occasion)
    car_clause = (
        "Use the EXACT car from the attached photo as the hero subject — preserve its real "
        "body shape, colour, grille, badges and wheels precisely; do NOT redesign or recolour it. "
        "Place it prominently in the lower half, dynamically lit."
        if has_car_image else
        f"Feature a premium, accurate Nissan {vehicle or 'SUV'} as the hero subject in the lower half."
    )
    channel_hint = _CHANNEL_HINT.get((channel or "").lower())

    lines = [
    "You are a Senior Art Director at a premium automotive advertising agency specialising in Indian market social media campaigns.",

    "Your task is to create a PREMIUM AUTOMOTIVE MARKETING POSTER, NOT a simple vehicle render.",

    _FORMAT_RULE,

    _layout_zones(has_logo),

    "The final image should resemble a professionally designed Nissan India advertising campaign similar to premium festival, lifestyle, family, seasonal, awareness or promotional campaigns.",

    "PRIMARY FOCUS:",
    "Campaign story, environment, people, culture, lifestyle and atmosphere.",

    "SECONDARY FOCUS:",
    "The Nissan vehicle integrated naturally into the campaign story — large and fully visible in ZONE 3 CENTER.",

    "COMPOSITION RULES:",
    "Respect the five-zone layout strictly. Environment and storytelling occupy the background.",
    "Vehicle must be fully visible (no cropping), sharp, dynamically lit, placed in the center zone.",
    "Create a complete social media advertising creative, not a catalog image.",

    BRAND_STYLE,

    f"Occasion / theme: {occasion}.",

    car_clause,

    f"Background scene: {scene}.",

    "Include campaign-relevant storytelling, emotional context, realistic lifestyle elements and rich environmental depth.",

    "Reserve clean areas for headline, campaign messaging, offer badges and feature highlights.",

    "Use premium advertising photography, cinematic lighting, luxury colour grading and agency-quality art direction.",

    "Avoid showroom photography, studio renders, launch stages, isolated vehicles, plain backgrounds, revolving platforms and catalog-style compositions.",
]
    if offer:
        lines.append(f'Add a small premium offer badge with the text "{offer}".')
    if has_logo:
        lines.append(
            "LOGO MANDATE (highest priority): The logo in ZONE 1 MUST be taken verbatim from the "
            "FIRST image supplied as input. Render it pixel-perfect — same colours, same shape, "
            "same text. Do NOT generate, hallucinate, redesign, recolour, or substitute any other "
            "logo, emblem, or Nissan stock branding. The user-selected logo is the ONLY branding "
            "permitted in this zone."
        )
    else:
        lines.append("Include a small, correct NISSAN logo/badge.")
    if channel_hint:
        lines.append(f"Optimise the layout for {channel} — {channel_hint}.")
    lines.append(
        "Warm cinematic advertising lighting, rich saturated colours, balanced premium composition, "
        "and clean negative space in each zone so text stays legible."
    )
    lines.append(
        "Final output: VERTICAL PORTRAIT 4:5 (1080×1350 px). "
        "Do NOT add watermarks, stock logos, gibberish or misspelt text; spell every word exactly as given."
    )
    if instr:
        lines.append(f"Additional art direction from the user: {instr}")

    return "\n".join(lines)
