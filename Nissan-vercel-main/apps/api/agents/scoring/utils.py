import json
import re
from datetime import datetime
from typing import Optional


def parse_json_safely(text: str) -> dict:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


def format_interactions_for_llm(interactions: list) -> str:
    if not interactions:
        return "No interactions recorded."
    lines = []
    for i, interaction in enumerate(interactions, 1):
        date_val = interaction.get("date", "unknown date")
        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)
        itype = interaction.get("type", "unknown")
        notes = interaction.get("notes", "")
        sp = interaction.get("salesperson_id", "")
        lines.append(f"{i}. [{date_str}] {itype}{' (' + sp + ')' if sp else ''}: {notes}")
    return "\n".join(lines)


def validate_phone_number(phone: str) -> bool:
    if not phone:
        return False
    cleaned = re.sub(r'[\s\-\(\)]', '', str(phone))
    patterns = [
        r'^\+91[6-9]\d{9}$',
        r'^91[6-9]\d{9}$',
        r'^[6-9]\d{9}$',
    ]
    return any(re.match(p, cleaned) for p in patterns)


def run_duplicate_detection(phone: str, name: str) -> dict:
    return {"match_probability": 0.0, "matched_lead_id": None}


def compute_emi_affordability(notes: str, state: dict) -> int:
    salary_match = re.search(r'salary[^\d]*(\d[\d,]*)', notes, re.IGNORECASE)
    if salary_match:
        try:
            salary = int(salary_match.group(1).replace(',', ''))
            if salary >= 80000:
                return 12
            elif salary >= 50000:
                return 9
            elif salary >= 30000:
                return 6
            else:
                return 3
        except ValueError:
            pass
    return 5


def check_budget_alignment(notes: str, state: dict) -> int:
    budget_match = re.search(
        r'budget[^\d]*(\d[\d,.]*)\s*(lakh|lac|l\b)?', notes, re.IGNORECASE
    )
    if budget_match:
        try:
            raw = float(budget_match.group(1).replace(',', ''))
            unit = (budget_match.group(2) or "").lower()
            total = raw * 100000 if unit in ("lakh", "lac", "l") else raw
            if total >= 1500000:
                return 10
            elif total >= 1000000:
                return 7
            elif total >= 700000:
                return 5
            else:
                return 3
        except (ValueError, TypeError):
            pass
    return 5


def extract_desired_variant(notes: str) -> Optional[str]:
    notes_lower = notes.lower()
    variant_map = {
        "top":    ["top variant", "top model", "fully loaded", "premium variant", "top end"],
        "mid":    ["mid variant", "middle variant", " vx ", " zx "],
        "base":   ["base variant", "entry level", "basic model", " lx ", " lxi "],
        "petrol": ["petrol"],
        "diesel": ["diesel"],
        "ev":     ["electric", " ev ", "battery"],
        "hybrid": ["hybrid"],
    }
    for variant, keywords in variant_map.items():
        if any(kw in notes_lower for kw in keywords):
            return variant
    return None


def check_inventory(variant: str) -> dict:
    status = {
        "top":    {"available": True,  "eta_days": 0},
        "mid":    {"available": True,  "eta_days": 0},
        "base":   {"available": True,  "eta_days": 0},
        "petrol": {"available": True,  "eta_days": 0},
        "diesel": {"available": False, "eta_days": 45},
        "ev":     {"available": False, "eta_days": 90},
        "hybrid": {"available": False, "eta_days": 60},
    }
    return status.get(variant, {"available": True, "eta_days": 0})


def inventory_has_7_seater() -> bool:
    return True


def decay_factor(interaction_date: datetime, now: Optional[datetime] = None) -> float:
    if now is None:
        now = datetime.now()
    days_ago = (now - interaction_date).days
    if days_ago <= 7:
        return 1.0
    elif days_ago <= 14:
        return 0.75
    elif days_ago <= 30:
        return 0.50
    elif days_ago <= 60:
        return 0.25
    else:
        return 0.10
