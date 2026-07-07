# LangGraph Scoring Agent
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## Architecture Overview

The LangGraph scoring agent implements the lead intelligence platform as a stateful, multi-node directed graph. Each node handles a specific scoring responsibility. The graph routes between nodes based on evidence availability, score thresholds, and detected flags.

---

## Agent State Schema

```python
from typing import TypedDict, Optional, List
from datetime import datetime

class LeadState(TypedDict):
    # Identity
    lead_id: str
    customer_name: str
    phone: str
    email: Optional[str]
    
    # Raw CRM Data
    interaction_log: List[dict]
    call_recordings: List[dict]
    whatsapp_log: List[dict]
    website_analytics: dict
    
    # Computed Scores
    intent_score: Optional[int]
    engagement_score: Optional[int]
    urgency_score: Optional[int]
    financial_readiness: Optional[int]
    product_fit: Optional[int]
    competitive_risk: Optional[int]
    relationship_strength: Optional[int]
    sentiment_score: Optional[int]
    total_score: Optional[int]
    
    # Classification
    category: Optional[str]
    purchase_probability: Optional[float]
    journey_stage: Optional[int]
    
    # Flags
    missing_data_flags: List[str]
    competitor_alert: bool
    competitor_details: Optional[str]
    validation_flags: List[str]
    requires_manager_review: bool
    
    # Output
    strengths: List[str]
    risks: List[str]
    recommended_action: Optional[str]
    follow_up_interval_hours: Optional[int]
    reasoning: Optional[str]
    
    # Meta
    score_trend: Optional[str]
    previous_score: Optional[int]
    algorithm_version: str
    computed_at: datetime
```

---

## Node Definitions

### Node 1: `ingest_and_validate`

```python
def ingest_and_validate(state: LeadState) -> LeadState:
    """
    Validates incoming lead data for completeness and data quality.
    Sets missing_data_flags and validation_flags.
    Enforces minimum data threshold (Rule V-15).
    """
    flags = []
    validation_flags = []
    
    # Check minimum data threshold
    if not state.get("phone"):
        flags.append("PHONE_MISSING")
    if not state.get("interaction_log"):
        flags.append("NO_INTERACTIONS_LOGGED")
    
    # Duplicate detection (calls dedup service)
    duplicate_check = run_duplicate_detection(state["phone"], state["customer_name"])
    if duplicate_check["match_probability"] > 0.85:
        validation_flags.append(f"POTENTIAL_DUPLICATE: {duplicate_check['matched_lead_id']}")
    
    # Phone number validation
    if not validate_phone_number(state["phone"]):
        flags.append("INVALID_PHONE_NUMBER")
        validation_flags.append("PHONE_VALIDATION_FAILED")
    
    # Financial data check
    financial_data_present = any(
        "budget" in i.get("notes", "").lower() or 
        "salary" in i.get("notes", "").lower() or
        "loan" in i.get("notes", "").lower()
        for i in state.get("interaction_log", [])
    )
    if not financial_data_present:
        flags.append("FINANCIAL_DATA_MISSING")
    
    return {
        **state,
        "missing_data_flags": flags,
        "validation_flags": validation_flags
    }
```

---

### Node 2: `compute_engagement_score`

```python
def compute_engagement_score(state: LeadState) -> LeadState:
    """
    Scores all engagement signals with recency decay applied.
    """
    from datetime import datetime, timedelta
    
    score = 0
    now = datetime.now()
    
    def decay_factor(interaction_date: datetime) -> float:
        days_ago = (now - interaction_date).days
        if days_ago <= 7: return 1.0
        elif days_ago <= 14: return 0.75
        elif days_ago <= 30: return 0.50
        elif days_ago <= 60: return 0.25
        else: return 0.10
    
    walk_in_count = 0
    for interaction in state.get("interaction_log", []):
        decay = decay_factor(interaction["date"])
        itype = interaction.get("type")
        
        if itype == "walk_in":
            walk_in_count += 1
            base = 5 if walk_in_count == 1 else (8 if walk_in_count == 2 else 10)
            score += base * decay
        elif itype == "test_drive_completed":
            score += 6 * decay
        elif itype == "inbound_call":
            score += 8 * decay
        elif itype == "outbound_call_answered_meaningful":
            score += 5 * decay
    
    for msg in state.get("whatsapp_log", []):
        decay = decay_factor(msg["date"])
        if msg.get("direction") == "inbound":
            score += 7 * decay
        elif msg.get("response_time_hours", 999) <= 1:
            score += 5 * decay
        elif msg.get("response_time_hours", 999) <= 24:
            score += 3 * decay
        elif msg.get("blue_tick_no_reply"):
            score -= 2 * decay
    
    # Website engagement
    website = state.get("website_analytics", {})
    if website.get("page_views", 0) >= 5:
        score += 4
    if website.get("emi_calculator_used"):
        score += 5
    if website.get("test_drive_booking_clicked"):
        score += 7
    
    # Cap at 20
    engagement_score = min(round(score), 20)
    
    return {**state, "engagement_score": max(engagement_score, 0)}
```

---

### Node 3: `compute_intent_score`

```python
def compute_intent_score(state: LeadState) -> LeadState:
    """
    Uses LLM to analyse interaction text for intent signals.
    Calls Claude API with structured prompt.
    """
    import anthropic
    
    client = anthropic.Anthropic()
    
    # Prepare interaction text
    interaction_text = format_interactions_for_llm(state["interaction_log"])
    
    prompt = f"""
You are an automotive sales intent analyser. Analyse the following customer interactions and score the intent from 0–25.

SCORING RULES:
- Asked for final on-road quotation: +8
- Confirmed variant and colour: +7
- Asked about booking process/documents: +7
- Asked delivery timeline for specific unit: +6
- Stated personal purchase deadline: +5
- Asked about registration/insurance: +4
- Multiple specific feature questions on one variant: +3

NEGATIVE:
- General browsing questions: -3
- "For reference only" framing: -4
- "No hurry, just exploring": -5

INTERACTION LOG:
{interaction_text}

Return ONLY a JSON object: {{"intent_score": <0-25>, "evidence": ["list of specific signals found"], "flags": ["any contradictions"]}}
"""
    
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    result = parse_json_safely(response.content[0].text)
    
    return {
        **state,
        "intent_score": min(result.get("intent_score", 0), 25),
        "strengths": state.get("strengths", []) + result.get("evidence", [])
    }
```

---

### Node 4: `compute_financial_score`

```python
def compute_financial_score(state: LeadState) -> LeadState:
    """
    Scores financial readiness from CRM data.
    Applies hard caps per validation rules.
    """
    score = 0
    financial_status = "unknown"
    
    notes_text = " ".join([
        i.get("notes", "") for i in state.get("interaction_log", [])
    ]).lower()
    
    # Detect financial signals
    if "cash" in notes_text or "own funds" in notes_text:
        score = 15
        financial_status = "own_funds"
    elif "pre-approved" in notes_text or "loan approved" in notes_text:
        score = 13
        financial_status = "loan_approved"
    elif "loan rejected" in notes_text:
        score = 2
        financial_status = "loan_rejected"
        state["risks"].append("Loan rejection recorded — explore NBFC options")
    elif "waiting for bonus" in notes_text:
        score = 8
        financial_status = "loan_pending"
    elif "salary" in notes_text or "income" in notes_text:
        # Estimate from salary data if present
        score = compute_emi_affordability(notes_text, state)
        financial_status = "loan_pending"
    elif "budget" in notes_text:
        score = check_budget_alignment(notes_text, state)
        financial_status = "loan_pending"
    else:
        score = 0
        state["missing_data_flags"].append("FINANCIAL_DATA_MISSING")
    
    return {
        **state,
        "financial_readiness": min(score, 15),
        "financial_status": financial_status
    }
```

---

### Node 5: `compute_urgency_score`

```python
def compute_urgency_score(state: LeadState) -> LeadState:
    """
    Detects urgency signals including explicit deadlines,
    event-based urgency, and temporal compression.
    """
    score = 0
    notes_combined = " ".join([
        i.get("notes", "") for i in state.get("interaction_log", [])
    ]).lower()
    
    # Explicit deadline
    if any(phrase in notes_combined for phrase in 
           ["book today", "this weekend", "before month end", "this week"]):
        score += 10
    
    # Event-based urgency
    if any(phrase in notes_combined for phrase in 
           ["marriage", "wedding", "festival", "pongal", "diwali", "new year"]):
        score += 8
    
    # Financial year urgency
    if any(phrase in notes_combined for phrase in 
           ["march 31", "financial year", "tax saving", "april 1"]):
        score += 7
    
    # Vehicle breakdown urgency
    if any(phrase in notes_combined for phrase in 
           ["breakdown", "accident", "repair", "urgent", "immediate"]):
        score += 9
    
    # Temporal compression (visits accelerating)
    visit_dates = [
        i["date"] for i in state.get("interaction_log", [])
        if i.get("type") == "walk_in"
    ]
    if len(visit_dates) >= 3:
        visit_dates.sort()
        gap_1 = (visit_dates[1] - visit_dates[0]).days
        gap_2 = (visit_dates[2] - visit_dates[1]).days
        if gap_2 < gap_1 * 0.5:  # Visits accelerating
            score += 5
    
    # Negative urgency signals
    if any(phrase in notes_combined for phrase in 
           ["no hurry", "next year", "6 months", "after increment"]):
        score -= 6
    
    if any(phrase in notes_combined for phrase in 
           ["someday", "eventually", "when time comes"]):
        score -= 8
    
    return {**state, "urgency_score": max(min(score, 15), 0)}
```

---

### Node 6: `compute_competitive_risk`

```python
def compute_competitive_risk(state: LeadState) -> LeadState:
    """
    Identifies competitive risk and applies penalty.
    Competitor booking = score 0/5 with alert triggered.
    """
    base = 5
    alert = False
    details = None
    
    notes_combined = " ".join([
        i.get("notes", "") for i in state.get("interaction_log", [])
    ]).lower()
    
    competitors = {
        "hyundai": -1, "creta": -2, "kia": -1, "seltos": -2,
        "tata": -1, "nexon": -2, "mahindra": -1, "xuv": -2,
        "toyota": -1, "honda": -1, "mg": -1, "hector": -2,
        "maruti": -1, "suzuki": -1, "scorpio": -2
    }
    
    competitor_deduction = 0
    detected_competitors = []
    
    for competitor, penalty in competitors.items():
        if competitor in notes_combined:
            competitor_deduction += abs(penalty)
            detected_competitors.append(competitor)
    
    # Test drove competitor
    if "test drove" in notes_combined and any(c in notes_combined for c in competitors):
        competitor_deduction += 2
    
    # Competitor booked
    if "booked" in notes_combined and any(c in notes_combined for c in competitors):
        competitor_deduction = 5  # Full penalty
        alert = True
        details = f"Competitor booking detected: {', '.join(detected_competitors)}"
    
    final_score = max(base - competitor_deduction, 0)
    
    if detected_competitors:
        alert = True
        details = details or f"Comparing with: {', '.join(detected_competitors)}"
    
    return {
        **state,
        "competitive_risk": final_score,
        "competitor_alert": alert,
        "competitor_details": details
    }
```

---

### Node 7: `compute_relationship_and_sentiment`

```python
def compute_relationship_and_sentiment(state: LeadState) -> LeadState:
    """
    Scores relationship strength and NLP sentiment from interaction text.
    """
    import anthropic
    
    relationship_score = 1  # Base: new customer
    
    notes_combined = " ".join([i.get("notes", "") for i in state.get("interaction_log", [])]).lower()
    
    # Relationship strength
    if "existing customer" in notes_combined or "repeat" in notes_combined:
        relationship_score = 5
    elif "referred by" in notes_combined:
        relationship_score = 4
    elif "service history" in notes_combined:
        relationship_score = 3
    
    # LLM sentiment analysis
    client = anthropic.Anthropic()
    recent_notes = [i.get("notes", "") for i in state.get("interaction_log", [])[-5:]]
    
    sentiment_prompt = f"""
Rate the overall customer sentiment in these automotive dealership interaction notes from 1–5 (1=hostile, 3=neutral, 5=enthusiastic).

Notes: {" | ".join(recent_notes)}

Return ONLY: {{"sentiment_score": <1-5>, "tone": "hostile|negative|neutral|positive|enthusiastic"}}
"""
    
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=100,
        messages=[{"role": "user", "content": sentiment_prompt}]
    )
    
    sentiment_result = parse_json_safely(response.content[0].text)
    sentiment_score = sentiment_result.get("sentiment_score", 3)
    
    return {
        **state,
        "relationship_strength": relationship_score,
        "sentiment_score": sentiment_score
    }
```

---

### Node 8: `compute_product_fit`

```python
def compute_product_fit(state: LeadState) -> LeadState:
    """
    Scores fit between customer requirement and available inventory.
    """
    score = 5  # Base
    notes = " ".join([i.get("notes", "") for i in state.get("interaction_log", [])]).lower()
    
    # Stock availability (query inventory system)
    desired_variant = extract_desired_variant(notes)
    if desired_variant:
        stock_status = check_inventory(desired_variant)
        if stock_status["available"]:
            score = 10
        elif stock_status["eta_days"] <= 30:
            score = 7
        elif stock_status["eta_days"] <= 60:
            score = 5
        else:
            score = 3
            state["risks"].append(f"Long wait for preferred variant: {stock_status['eta_days']} days")
    
    # Feature mismatch check
    if "7 seater" in notes and not inventory_has_7_seater():
        score -= 3
        state["risks"].append("Customer wants 7-seater; limited/no stock")
    
    return {**state, "product_fit": max(min(score, 10), 0)}
```

---

### Node 9: `aggregate_and_classify`

```python
def aggregate_and_classify(state: LeadState) -> LeadState:
    """
    Aggregates all dimension scores into total.
    Applies validation caps (V-01 through V-05).
    Classifies into HOT+/HOT/WARM/COLD/DEAD.
    """
    # Aggregate
    total = (
        (state.get("intent_score") or 0) +
        (state.get("engagement_score") or 0) +
        (state.get("urgency_score") or 0) +
        (state.get("financial_readiness") or 0) +
        (state.get("product_fit") or 0) +
        (state.get("competitive_risk") or 0) +
        (state.get("relationship_strength") or 0) +
        (state.get("sentiment_score") or 0)
    )
    
    # Apply validation caps
    missing_flags = state.get("missing_data_flags", [])
    
    # Rule V-03: Financial data gate
    if "FINANCIAL_DATA_MISSING" in missing_flags:
        total = min(total, 74)
    
    # Rule V-01: Evidence citation check
    evidence_count = len(state.get("strengths", []))
    if total > 70 and evidence_count < 5:
        total = min(total, 65)
        state["validation_flags"].append("INSUFFICIENT_EVIDENCE_FOR_HIGH_SCORE")
    
    # Rule V-02: Dimension consistency check
    intent = state.get("intent_score", 0)
    engagement = state.get("engagement_score", 0)
    if abs((intent / 25 * 20) - engagement) > 15:
        state["validation_flags"].append("DIMENSION_INCONSISTENCY_DETECTED")
    
    # Dead lead override
    validation_flags = state.get("validation_flags", [])
    if "INVALID_PHONE_NUMBER" in validation_flags or "PHONE_MISSING" in missing_flags:
        total = min(total, 10)
    
    # Classify
    if total >= 85:
        category = "HOT+"
        probability = 0.85 + (total - 85) * 0.01
    elif total >= 65:
        category = "HOT"
        probability = 0.60 + (total - 65) * 0.01
    elif total >= 40:
        category = "WARM"
        probability = 0.25 + (total - 40) * 0.012
    elif total >= 15:
        category = "COLD"
        probability = 0.05 + (total - 15) * 0.006
    else:
        category = "DEAD"
        probability = 0.02
    
    # Calculate score trend
    previous = state.get("previous_score")
    trend = "stable"
    if previous:
        if total > previous + 5:
            trend = "improving"
        elif total < previous - 5:
            trend = "declining"
    
    # Determine follow-up interval
    follow_up_map = {
        "HOT+": 6,
        "HOT": 24,
        "WARM": 120,
        "COLD": 336,
        "DEAD": 4380
    }
    
    return {
        **state,
        "total_score": total,
        "category": category,
        "purchase_probability": round(min(probability, 0.99), 2),
        "score_trend": trend,
        "score_change": total - previous if previous else None,
        "follow_up_interval_hours": follow_up_map[category],
        "requires_manager_review": len(state.get("validation_flags", [])) > 0 or total >= 85
    }
```

---

### Node 10: `generate_reasoning_and_action`

```python
def generate_reasoning_and_action(state: LeadState) -> LeadState:
    """
    Uses Claude to generate human-readable reasoning and recommended action.
    Enforces anti-hallucination rules.
    """
    import anthropic
    
    client = anthropic.Anthropic()
    
    score_summary = f"""
Score: {state['total_score']}/100 | Category: {state['category']}

Dimension Breakdown:
- Intent: {state.get('intent_score')}/25
- Engagement: {state.get('engagement_score')}/20
- Urgency: {state.get('urgency_score')}/15
- Financial: {state.get('financial_readiness')}/15
- Product Fit: {state.get('product_fit')}/10
- Competitive Risk: {state.get('competitive_risk')}/5
- Relationship: {state.get('relationship_strength')}/5
- Sentiment: {state.get('sentiment_score')}/5

Strengths: {state.get('strengths')}
Risks: {state.get('risks')}
Missing Data: {state.get('missing_data_flags')}
Competitor Alert: {state.get('competitor_details')}
Financial Status: {state.get('financial_status')}
Journey Stage: {state.get('journey_stage')}
"""
    
    prompt = f"""
You are an automotive sales AI assistant generating a lead scoring report for a salesperson.

CRITICAL RULES:
1. Only reference facts from the score summary provided. Do not invent interactions.
2. If data is missing, say so explicitly.
3. Recommended action must be specific and immediately actionable.
4. Reasoning must justify the score given, not idealise the customer.
5. Maximum 150 words for reasoning. Maximum 60 words for recommended_action.

{score_summary}

Return ONLY JSON:
{{
  "reasoning": "<150 word explanation>",
  "recommended_action": "<60 word specific next step>"
}}
"""
    
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    result = parse_json_safely(response.content[0].text)
    
    return {
        **state,
        "reasoning": result.get("reasoning", ""),
        "recommended_action": result.get("recommended_action", "")
    }
```

---

### Node 11: `format_output`

```python
def format_output(state: LeadState) -> dict:
    """
    Formats final JSON output per master schema.
    """
    from datetime import datetime
    
    return {
        "schema_version": "1.0",
        "lead_id": state["lead_id"],
        "timestamp": datetime.now().isoformat(),
        "lead_score": {
            "total": state["total_score"],
            "breakdown": {
                "intent_score": state.get("intent_score"),
                "engagement_score": state.get("engagement_score"),
                "urgency_score": state.get("urgency_score"),
                "financial_readiness": state.get("financial_readiness"),
                "product_fit": state.get("product_fit"),
                "competitive_risk": state.get("competitive_risk"),
                "relationship_strength": state.get("relationship_strength"),
                "sentiment_score": state.get("sentiment_score")
            }
        },
        "category": state["category"],
        "purchase_probability": state["purchase_probability"],
        "strengths": state.get("strengths", []),
        "risks": state.get("risks", []),
        "missing_data_flags": state.get("missing_data_flags", []),
        "recommended_action": state.get("recommended_action"),
        "follow_up_interval_hours": state.get("follow_up_interval_hours"),
        "reasoning": state.get("reasoning"),
        "competitor_alert": state.get("competitor_alert", False),
        "competitor_details": state.get("competitor_details"),
        "financial_status": state.get("financial_status"),
        "journey_stage": state.get("journey_stage"),
        "score_trend": state.get("score_trend"),
        "previous_score": state.get("previous_score"),
        "score_change": state.get("score_change"),
        "validation_flags": state.get("validation_flags", []),
        "requires_manager_review": state.get("requires_manager_review", False),
        "algorithm_version": "1.0.0"
    }
```

---

## Graph Construction

```python
from langgraph.graph import StateGraph, END

def build_scoring_graph():
    graph = StateGraph(LeadState)
    
    # Add all nodes
    graph.add_node("ingest_and_validate", ingest_and_validate)
    graph.add_node("compute_engagement", compute_engagement_score)
    graph.add_node("compute_intent", compute_intent_score)
    graph.add_node("compute_financial", compute_financial_score)
    graph.add_node("compute_urgency", compute_urgency_score)
    graph.add_node("compute_competitive_risk", compute_competitive_risk)
    graph.add_node("compute_relationship_sentiment", compute_relationship_and_sentiment)
    graph.add_node("compute_product_fit", compute_product_fit)
    graph.add_node("aggregate_classify", aggregate_and_classify)
    graph.add_node("generate_reasoning", generate_reasoning_and_action)
    graph.add_node("format_output", format_output)
    
    # Set entry point
    graph.set_entry_point("ingest_and_validate")
    
    # Sequential scoring pipeline
    graph.add_edge("ingest_and_validate", "compute_engagement")
    graph.add_edge("compute_engagement", "compute_intent")
    graph.add_edge("compute_intent", "compute_financial")
    graph.add_edge("compute_financial", "compute_urgency")
    graph.add_edge("compute_urgency", "compute_competitive_risk")
    graph.add_edge("compute_competitive_risk", "compute_relationship_sentiment")
    graph.add_edge("compute_relationship_sentiment", "compute_product_fit")
    graph.add_edge("compute_product_fit", "aggregate_classify")
    
    # Conditional edge: dead lead fast-exits reasoning step
    def should_generate_full_reasoning(state: LeadState) -> str:
        if state.get("category") == "DEAD":
            return "format_output"
        return "generate_reasoning"
    
    graph.add_conditional_edges(
        "aggregate_classify",
        should_generate_full_reasoning,
        {
            "generate_reasoning": "generate_reasoning",
            "format_output": "format_output"
        }
    )
    
    graph.add_edge("generate_reasoning", "format_output")
    graph.add_edge("format_output", END)
    
    return graph.compile()

# Instantiate
scoring_agent = build_scoring_graph()
```

---

## Usage

```python
# Score a single lead
result = scoring_agent.invoke({
    "lead_id": "LD-2026-001847",
    "customer_name": "Rajesh Kumar",
    "phone": "+919876543210",
    "interaction_log": [
        {
            "date": datetime(2026, 6, 5),
            "type": "walk_in",
            "notes": "Visited with wife. Interested in top variant. Asked about delivery.",
            "salesperson_id": "SP-042"
        },
        {
            "date": datetime(2026, 6, 7),
            "type": "walk_in", 
            "notes": "Second visit. Wife approved interior. Asked for final on-road price. Mentioned 'booking this weekend'.",
            "salesperson_id": "SP-042"
        }
    ],
    "whatsapp_log": [
        {
            "date": datetime(2026, 6, 7),
            "direction": "inbound",
            "response_time_hours": 0.5,
            "message": "Can you confirm the white top variant delivery time?"
        }
    ],
    "website_analytics": {
        "page_views": 8,
        "emi_calculator_used": True,
        "test_drive_booking_clicked": False
    },
    "missing_data_flags": [],
    "validation_flags": [],
    "strengths": [],
    "risks": [],
    "algorithm_version": "1.0.0"
})

print(result)
```

---

## Deployment Notes

- **CRM Integration:** The agent receives lead data via webhook from the CRM system on every interaction update.
- **Re-scoring Trigger:** Every new CRM entry (call, visit, WhatsApp, website event) triggers a re-score.
- **Score Storage:** All scores are stored in the audit log with immutable timestamps (Rule V-22).
- **Manager Alerts:** Leads with `requires_manager_review: true` or `category: HOT+` trigger a manager notification within 15 minutes.
- **ML Feedback Loop:** Converted leads (purchased) and dead leads (confirmed non-purchase) are exported monthly for model retraining.
