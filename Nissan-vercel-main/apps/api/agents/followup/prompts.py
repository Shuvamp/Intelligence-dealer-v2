"""Prompts for the Follow-up Agent."""

# -- Nissan advantages vs named competitors -----------------------------------
# Used only when customer explicitly mentioned a competitor in their messages.
# Framed positively - never mention the competitor brand in the outreach message.
NISSAN_ADVANTAGES: dict[str, list[str]] = {
    "kia": [
        "Magnite offers a class-leading turbocharged petrol engine at a better price point",
        "Lower EMI starting from ₹6,999/month with Nissan Finance",
        "Best-in-segment boot space of 336L for families",
        "Nissan's 2-year unlimited km warranty gives complete peace of mind",
    ],
    "hyundai": [
        "Magnite's 1.0L turbo petrol delivers 100PS - more punch for city and highway",
        "Better value with standard safety features like dual airbags and ABS",
        "Spacious cabin with best-in-class legroom in this segment",
        "Nissan's improved service network with doorstep pickup facility",
    ],
    "tata": [
        "Magnite offers a smoother CVT automatic option for stress-free city driving",
        "Lower 3-year maintenance cost compared to similarly priced alternatives",
        "Refined petrol engine with superior NVH (quieter cabin experience)",
        "Nissan's global platform with proven 4-star safety rating",
    ],
    "mahindra": [
        "Magnite is more fuel-efficient in city driving - up to 20kmpl on highway",
        "Better urban maneuverability with compact footprint, easy to park",
        "Turbocharged engine gives excellent performance without the bulk",
        "More competitive on-road price with better feature-to-cost ratio",
    ],
    "honda": [
        "Magnite brings genuine SUV ground clearance and road presence",
        "More modern platform with latest safety and infotainment features",
        "Better suited for Indian road conditions with superior suspension",
    ],
    "toyota": [
        "Magnite is purpose-built for the compact SUV segment Toyota doesn't directly target",
        "More accessible price with similar reliability backed by Nissan's global standards",
        "Higher ground clearance and SUV proportions for versatile use",
    ],
    "mg": [
        "Lower running and insurance costs with established Nissan service network",
        "Better resale value in Indian market with Nissan's longer legacy",
        "More affordable EMI with wider financing options through Nissan Finance",
    ],
    "maruti": [
        "Magnite offers genuine turbocharged performance - far more power than NA alternatives",
        "Larger cabin and boot space suitable for growing families",
        "Full SUV proportions with higher ground clearance for rough roads",
        "Significantly better performance specs at a comparable price point",
    ],
}

# -- Action decision ----------------------------------------------------------

ACTION_DECISION_SYSTEM = """
You are a Nissan dealership sales advisor. Given a lead's current status,
decide the single best next action.

Action types available:
  - call           : Phone call (best for HOT leads with phone)
  - whatsapp       : WhatsApp message (good for WARM leads)
  - email          : Email (for leads with only email, or formal follow-up)
  - test_drive     : Invite to test drive (for leads in qualified stage without test drive)
  - manager        : Escalate to manager (for special discount request or complex negotiation)
  - nurture        : Schedule long-term follow-up (for COLD leads or after-timeline triggers)
  - none           : No action (lead already has follow-up scheduled within 24h)

Rules:
  - Choose exactly ONE action
  - DEAD leads must get action_type = "none"
  - HOT lead + no test drive done -> prefer "call" to invite test drive
  - Lead idle > 7 days + HOT -> "call" urgently
  - Do not recommend "call" if no phone available
  - Competitor mentioned by customer is NOT a reason to escalate to manager -
    handle it with a confident whatsapp/call highlighting Nissan's strengths
  - Return JSON: {"action_type": "<string>", "rationale": "<1 sentence>", "channel": "<call|whatsapp|email|in_person>"}
"""

ACTION_DECISION_USER = """
Lead status:
  Category: {category}
  Score: {score_value}/100
  Stage: {stage}
  Days idle: {days_idle}
  Contact: phone={has_phone}, email={has_email}
  Vehicle: {vehicle_interest}
  Test drive done: {test_drive_done}
  Competitor mentioned by customer: {competitor_alert}
  Assignee: {has_assignee}

Last event ({last_event_type}):
  {last_event_summary}

Recommended action from scoring: {scoring_recommended_action}
"""

# -- Message draft ------------------------------------------------------------

MESSAGE_DRAFT_SYSTEM = """
You are a Nissan dealership salesperson drafting a customer outreach message.
Write a short, natural, friendly message in Indian English.

Rules:
  - Max 3 sentences
  - Use customer's first name if available
  - Mention the specific Nissan vehicle they are interested in if known
  - Do NOT be pushy or salesy
  - Do NOT mention "AI", "system", "automated", "algorithm"
  - For WhatsApp: conversational, can use one emoji
  - For Email: slightly more formal, no emoji
  - For call script: bullet points of what to say, conversational tone

Competitor comparison rules (ONLY when competitor_brand is provided):
  - The customer mentioned another brand -> naturally weave in 1-2 Nissan advantages
  - Frame advantages positively: "Our Magnite has X" not "Unlike Brand Y"
  - Do NOT name the competitor brand in the message
  - Advantages must feel like genuine product enthusiasm, not a sales pitch

Talking points (ALWAYS return these, competitor or not):
  - Provide 2-3 short Nissan talking points the salesperson can use, SPECIFIC to the
    customer's vehicle of interest (engine, space, safety, finance, warranty, service).
  - Each is one crisp phrase (max ~12 words), benefit-led, factual, on-brand.
  - These are internal notes for the rep — they do NOT have to appear in the message.

Return JSON: {"message": "<string>", "subject": "<string if email else null>", "talking_points": ["<point>", "..."]}
"""

MESSAGE_DRAFT_USER = """
Channel: {channel}
Customer name: {customer_name}
Nissan vehicle interest: {vehicle_interest}
Action purpose: {action_rationale}
Days since last contact: {days_idle}
Lead category: {category}
Assigned exec name: {exec_name}
Competitor mentioned by customer: {competitor_brand}
Nissan advantages to highlight (use 1-2 naturally if competitor_brand is set): {advantages}
"""

# -- Nissan talking points by model -------------------------------------------
# Deterministic fallback notes used when the LLM is unavailable / rate-limited,
# so a follow-up always carries Nissan advantages for the rep. Keyed by a token
# found in the vehicle name (lower-case).
NISSAN_VEHICLE_NOTES: dict[str, list[str]] = {
    "magnite": [
        "1.0L turbo petrol — 100PS, punchy in city & highway",
        "Class-leading 336L boot; spacious cabin for families",
        "EMI from ~₹6,999/mo via Nissan Finance",
        "2-year unlimited-km warranty for peace of mind",
    ],
    "kicks": [
        "Bold SUV stance with commanding road presence",
        "Premium cabin with large touchscreen & safety tech",
        "Comfortable highway cruiser with strong build quality",
        "Attractive exchange + finance offers available",
    ],
    "x-trail": [
        "Premium 7-seater SUV — versatile for big families",
        "Refined, powerful engine with smooth automatic",
        "Advanced safety suite and global 4-star pedigree",
        "Festive finance schemes on the premium range",
    ],
    "terrano": [
        "Proven rugged SUV built for Indian road conditions",
        "High ground clearance and confident ride quality",
        "Low running cost with wide service network",
        "Strong resale value backed by Nissan legacy",
    ],
    "sunny": [
        "Best-in-class rear legroom — limousine-like comfort",
        "Frugal, refined engine ideal for daily commutes",
        "Comfortable, quiet cabin for long drives",
        "Easy ownership with affordable maintenance",
    ],
}
DEFAULT_VEHICLE_NOTES: list[str] = [
    "Turbocharged performance with great fuel efficiency",
    "Spacious, feature-rich cabin with modern safety tech",
    "Flexible EMI & exchange offers via Nissan Finance",
    "Wide service network with reliable after-sales support",
]


def fallback_talking_points(vehicle: str | None, n: int = 3) -> list[str]:
    """Pick model-specific Nissan notes (or generic), used when no LLM output."""
    v = (vehicle or "").lower()
    for key, notes in NISSAN_VEHICLE_NOTES.items():
        if key in v:
            return notes[:n]
    return DEFAULT_VEHICLE_NOTES[:n]
