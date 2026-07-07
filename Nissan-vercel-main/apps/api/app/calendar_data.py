"""Deterministic India / Tamil Nadu marketing-occasion calendar.

Fallback for the Calendarific API (free tier is heavily rate-limited and blocks
non-browser User-Agents). Month -> list of occasions a Nissan dealer can build a
campaign around. Fixed-date holidays are exact; lunar/variable festivals use an
approximate day and are overridden by Calendarific whenever its API responds.

kind: "festival" | "holiday" | "regional" | "dealership"
"""

# month (1-12) -> [(day, name, kind, theme, suggestion)]
INDIA_OCCASIONS: dict[int, list[tuple[int, str, str, str, str]]] = {
    1: [
        (1,  "New Year's Day", "holiday", "Fresh Start", "Kick off the year with new-year exchange and finance offers."),
        (14, "Pongal / Makar Sankranti", "regional", "Harvest Festival", "Tamil Nadu's biggest festival — family SUV and trade-in campaigns."),
        (26, "Republic Day", "holiday", "National Pride", "Republic Day savings event with patriotic creative."),
    ],
    2: [
        (14, "Valentine's Day", "dealership", "Couples & Lifestyle", "Romantic test-drive getaways and couple offers."),
        (19, "Maha Shivaratri", "festival", "Devotional", "Festive blessings — service and accessory packages."),
    ],
    3: [
        (8,  "International Women's Day", "dealership", "Women Drivers", "Celebrate women drivers with safety-first messaging."),
        (14, "Holi", "festival", "Colours of Joy", "Vibrant Holi creative — bright, family, festive offers."),
        (21, "Ugadi / Gudi Padwa", "regional", "New Year (South/West)", "Auspicious new-beginnings purchase offers."),
    ],
    4: [
        (14, "Tamil New Year / Vishu", "regional", "Puthandu", "Tamil New Year — the prime regional buying occasion."),
        (14, "Ambedkar Jayanti", "holiday", "Equality", "Public-holiday weekend walk-in drive."),
        (18, "Good Friday", "holiday", "Long Weekend", "Long-weekend test-drive and getaway campaign."),
    ],
    5: [
        (1,  "Labour Day", "holiday", "Workers' Day", "Salute to workers — special EMI and exchange schemes."),
        (10, "Mother's Day", "dealership", "Family & Care", "Family-SUV and safety messaging for mothers."),
        (12, "Buddha Purnima", "festival", "Peace & Mindfulness", "Calm, premium brand-awareness creative."),
    ],
    6: [
        (5,  "World Environment Day", "dealership", "Sustainability", "Spotlight efficiency, EV/hybrid and eco-driving."),
        (16, "Bakrid / Eid al-Adha", "festival", "Festive Generosity", "Eid festive offers and finance packages."),
        (21, "Father's Day", "dealership", "Family & Dads", "Emotional Father's Day SUV gifting campaign."),
        (21, "June Solstice", "dealership", "Summer Drive", "Summer road-trip and AC-service campaign."),
        (26, "Muharram / Ashura", "festival", "Observance", "Respectful, low-key service-focused messaging."),
    ],
    7: [
        (10, "Guru Purnima", "festival", "Gratitude", "Thank-your-mentor loyalty and referral push."),
        (26, "Kargil Vijay Diwas", "holiday", "National Pride", "Patriotic salute creative; monsoon-readiness service."),
    ],
    8: [
        (9,  "Raksha Bandhan", "festival", "Sibling Bond", "Gifting and family-bonding road-trip offers."),
        (15, "Independence Day", "holiday", "Freedom Sale", "Flagship Independence Day savings event."),
        (16, "Janmashtami", "festival", "Devotional Joy", "Festive blessings and accessory bundles."),
    ],
    9: [
        (5,  "Teacher's Day", "dealership", "Respect & Learning", "Educator appreciation finance offers."),
        (14, "Onam", "regional", "Harvest (Kerala/South)", "Onam festive SUV and trade-in campaign."),
        (26, "Ganesh Chaturthi", "festival", "New Beginnings", "Auspicious purchase muhurat campaign."),
    ],
    10: [
        (2,  "Gandhi Jayanti", "holiday", "Peace & Simplicity", "Long-weekend walk-in and service drive."),
        (12, "Navratri begins", "festival", "Nine Nights", "Festive season launch — the biggest buying window."),
        (20, "Dussehra / Vijayadashami", "festival", "Victory & Auspice", "Vijayadashami muhurat delivery campaign."),
    ],
    11: [
        (1,  "Diwali", "festival", "Festival of Lights", "Peak festive sales — exchange, finance and gifting blitz."),
        (5,  "Guru Nanak Jayanti", "festival", "Gurpurab", "Festive blessings and special editions."),
        (14, "Children's Day", "dealership", "Family Safety", "Family-SUV safety and space messaging."),
    ],
    12: [
        (25, "Christmas", "holiday", "Festive Joy", "Year-end Christmas savings and gifting event."),
        (31, "New Year's Eve", "dealership", "Year-End Clearance", "Final push — year-end clearance and bonus offers."),
    ],
}


def fallback_opportunities(month: int, year: int) -> list[dict]:
    """Build month-plan opportunity dicts from the deterministic calendar."""
    out: list[dict] = []
    for day, name, kind, theme, suggestion in INDIA_OCCASIONS.get(month, []):
        out.append({
            "date": f"{year}-{month:02d}-{day:02d}",
            "name": name,
            "kind": kind,
            "theme": theme,
            "suggestion": suggestion,
        })
    return out
