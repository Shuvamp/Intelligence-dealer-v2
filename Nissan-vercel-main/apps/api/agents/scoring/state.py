from typing import TypedDict, Optional, List
from datetime import datetime


class LeadState(TypedDict, total=False):
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
    computed_at: Optional[datetime]

    # Extended
    financial_status: Optional[str]
    score_change: Optional[int]
    final_output: Optional[dict]
    scored_by: Optional[str]  # "groq_holistic" | "groq_holistic_backup" | "deterministic"
    score_notice: Optional[str]  # human-readable note when scoring took a non-ideal path (rate-limit / fallback)
