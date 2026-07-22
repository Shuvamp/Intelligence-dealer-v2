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

# Dealer contact bar rendered along the bottom footer of every poster.
# ponytail: hardcoded single-dealer (Vignesh Nissan) footer — move to
# tenant/locations DB once those rows carry address + phone data.
DEALER_FOOTER = (
    "Locations: Puducherry | Cuddalore | Viluppuram. "
    "Contact: +91 70944 41991 | +91 86808 88191 | +91 84899 44191."
)

# Mandatory canvas spec — portrait 4:5 only.
_FORMAT_RULE = (
    "CANVAS: Strict VERTICAL PORTRAIT format — 4:5 aspect ratio (1080×1350 px). "
    "Do NOT generate landscape, square, horizontal banner, Reels/Story (9:16), "
    "or website hero layouts under any circumstances."
)

# Never phrase composition guidance as short quoted label-like tokens (e.g.
# "ZONE 1 TOP") — image models reliably echo such tokens as literal on-image
# text, and negating the exact same quoted string right next to its use makes
# this worse, not better. Use plain descriptive prose instead, with no
# generic instruction below to keep things reinforced.
_NO_ANNOTATIONS_RULE = (
    "The final image must contain ONLY real, finished marketing content — actual logo, actual "
    "vehicle, actual headline copy, actual offer/CTA text, actual fine-print disclaimer. Do NOT "
    "render any section names, layout markers, numbering, bounding boxes, crop marks, alignment "
    "guides, grid lines, rulers, placeholder text (e.g. 'headline here', 'logo here'), watermarks, "
    "or any other planning/debugging overlay — the composition guidance below describes where "
    "content goes, not text to draw."
)

def _layout_zones(has_logo: bool, has_logo2: bool = False, car_count: int = 0) -> str:
    """Return the layout instruction, top-to-bottom, as plain prose (no ZONE-style labels)."""
    if has_logo and has_logo2:
        top_strip = (
            "Top strip: TWO logos, one in each top corner, taken VERBATIM from the input images. "
            "Place the FIRST input image (dealer logo) in the TOP-LEFT corner and the SECOND input "
            "image (Nissan brand logo) in the TOP-RIGHT corner. Render BOTH exactly as given — "
            "preserve every colour, shape, and letter. Do NOT redesign, recolour, crop, swap their "
            "corners, merge them, or substitute either with a generated or stock emblem."
        )
    elif has_logo:
        top_strip = (
            "Top strip: USE ONLY the logo from the FIRST image provided as input. "
            "Render it EXACTLY as given — preserve every colour, shape, and letter. "
            "Do NOT redesign, recolour, shrink, crop, replace, or in any way alter it. "
            "Do NOT substitute it with any stock Nissan logo, generated emblem, or default branding. "
            "Place it in the TOP-LEFT corner, and render the Nissan brand logo in the TOP-RIGHT corner."
        )
    else:
        top_strip = "Top strip: dealer logo in the top-left corner + Nissan brand logo in the top-right corner."
    return (
        "LAYOUT — stack five sections top to bottom, none may be omitted:\n"
        f"  {top_strip}\n"
        "  Upper section: Headline text (large, bold) + 1-line supporting subtext below it.\n"
        f"  Middle section: {f'ALL {car_count} hero vehicles together' if car_count > 1 else 'Hero vehicle'}"
        " — large, fully visible, sharp, dynamically lit. "
        "No vehicle may be cropped; "
        "show each full body including wheels.\n"
        "  Lower section: Offer details (price/discount/EMI) + prominent CTA (e.g. 'Book Now', 'Test Drive').\n"
        "  Bottom strip: a slim branded footer bar spanning the full width with a location pin icon and a "
        f"phone icon, showing this dealer contact info in small but legible text — {DEALER_FOOTER} "
        "Spell every location and phone number EXACTLY as given."
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
    car_image_count: int = 0,
    has_logo: bool = False,
    has_logo2: bool = False,
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
            f"{_NO_ANNOTATIONS_RULE}\n"
            "Return the complete edited poster in VERTICAL PORTRAIT 4:5 (1080×1350 px), "
            "high resolution, photoreal, spelling any text exactly as shown."
        )

    # ── create: compose a fresh poster ──────────────────────────────────────
    occasion = theme or title or "Nissan campaign"
    big_text = headline or theme or title or "Drive the Difference"
    scene = festive_scene(occasion)
    # Logos occupy the first one/two input images, so the car photos start after them.
    _first_car = 1 + int(has_logo) + int(has_logo2)
    if car_image_count > 1:
        car_clause = (
            f"{car_image_count} car photos are attached (input images {_first_car} to "
            f"{_first_car + car_image_count - 1}). EVERY ONE of them must appear in the poster as a "
            "hero subject — do not drop, merge, duplicate or substitute any of them. Preserve each "
            "car's real body shape, colour, grille, badges and wheels precisely; do NOT redesign or "
            "recolour them. Arrange all of them together in the middle section as one cohesive "
            "line-up (staggered depth or side by side), each fully visible and uncropped, sharing "
            "the same lighting, perspective and ground plane so the group looks like a single "
            "photograph."
        )
    elif car_image_count == 1:
        car_clause = (
            "Use the EXACT car from the attached photo as the hero subject — preserve its real "
            "body shape, colour, grille, badges and wheels precisely; do NOT redesign or recolour it. "
            "Place it prominently in the lower half, dynamically lit."
        )
    else:
        car_clause = f"Feature a premium, accurate Nissan {vehicle or 'SUV'} as the hero subject in the lower half."
    channel_hint = _CHANNEL_HINT.get((channel or "").lower())

    lines = [
    "You are a Senior Art Director at a premium automotive advertising agency specialising in Indian market social media campaigns.",

    "Your task is to create a PREMIUM AUTOMOTIVE MARKETING POSTER, NOT a simple vehicle render.",

    _FORMAT_RULE,

    _NO_ANNOTATIONS_RULE,

    _layout_zones(has_logo, has_logo2, car_image_count),

    "The final image should resemble a professionally designed Nissan India advertising campaign similar to premium festival, lifestyle, family, seasonal, awareness or promotional campaigns.",

    "PRIMARY FOCUS:",
    "Campaign story, environment, people, culture, lifestyle and atmosphere.",

    "SECONDARY FOCUS:",
    "The Nissan vehicle integrated naturally into the campaign story — large and fully visible in the middle section.",

    "COMPOSITION RULES:",
    "Respect the five-section layout strictly. Environment and storytelling occupy the background.",
    "Vehicle must be fully visible (no cropping), sharp, dynamically lit, placed in the middle section.",
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
    if has_logo and has_logo2:
        lines.append(
            "LOGO MANDATE (highest priority): render BOTH input logos pixel-perfect — the FIRST input "
            "image (dealer logo) in the TOP-LEFT corner, the SECOND input image (Nissan brand logo) in "
            "the TOP-RIGHT corner. Same colours, shapes, and text; do NOT swap corners, merge, redesign, "
            "recolour, or substitute either with a generated or stock emblem."
        )
    elif has_logo:
        lines.append(
            "LOGO MANDATE (highest priority): The dealer logo in the top-left MUST be taken verbatim from the "
            "FIRST image supplied as input. Render it pixel-perfect — same colours, same shape, "
            "same text. Do NOT generate, hallucinate, redesign, recolour, or substitute it. "
            "In the top-right corner render a correct Nissan brand logo."
        )
    else:
        lines.append("Include a correct dealer logo (top-left) and Nissan brand logo (top-right).")
    if channel_hint:
        lines.append(f"Optimise the layout for {channel} — {channel_hint}.")
    lines.append(
        "Warm cinematic advertising lighting, rich saturated colours, balanced premium composition, "
        "and clean negative space in each section so text stays legible."
    )
    lines.append(
        "Final output: VERTICAL PORTRAIT 4:5 (1080×1350 px). "
        "Do NOT add watermarks, stock logos, gibberish or misspelt text; spell every word exactly as given. "
        "Do NOT add section labels, layout numbers, bounding boxes, crop marks, or any planning/debug text."
    )
    if instr:
        lines.append(f"Additional art direction from the user: {instr}")

    return "\n".join(lines)
