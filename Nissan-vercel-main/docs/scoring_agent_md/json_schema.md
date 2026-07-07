# JSON Schema Reference
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## Master JSON Output Schema (Complete)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AutomotiveLeadScore",
  "description": "Standard output schema for AI automotive lead intelligence scoring",
  "type": "object",
  "required": [
    "schema_version", "lead_id", "timestamp", "lead_score",
    "category", "purchase_probability", "recommended_action", "reasoning"
  ],
  "properties": {
    "schema_version": {
      "type": "string",
      "description": "Version of the scoring schema used",
      "example": "1.0"
    },
    "lead_id": {
      "type": "string",
      "description": "Unique dealership CRM lead identifier",
      "example": "LD-2026-001847"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when score was computed"
    },
    "salesperson_id": {
      "type": "string",
      "description": "ID of the assigned salesperson"
    },
    "lead_score": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "breakdown": {
          "type": "object",
          "properties": {
            "intent_score": { "type": "integer", "minimum": 0, "maximum": 25 },
            "engagement_score": { "type": "integer", "minimum": 0, "maximum": 20 },
            "urgency_score": { "type": "integer", "minimum": 0, "maximum": 15 },
            "financial_readiness": { "type": "integer", "minimum": 0, "maximum": 15 },
            "product_fit": { "type": "integer", "minimum": 0, "maximum": 10 },
            "competitive_risk": { "type": "integer", "minimum": 0, "maximum": 5 },
            "relationship_strength": { "type": "integer", "minimum": 0, "maximum": 5 },
            "sentiment_score": { "type": "integer", "minimum": 0, "maximum": 5 }
          }
        }
      }
    },
    "category": {
      "type": "string",
      "enum": ["HOT+", "HOT", "WARM", "COLD", "DEAD"]
    },
    "purchase_probability": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0
    },
    "strengths": {
      "type": "array",
      "items": { "type": "string" }
    },
    "risks": {
      "type": "array",
      "items": { "type": "string" }
    },
    "missing_data_flags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Dimensions where data was insufficient for scoring"
    },
    "recommended_action": {
      "type": "string",
      "description": "Specific, immediately actionable next step for salesperson"
    },
    "follow_up_interval_hours": {
      "type": "integer",
      "description": "Maximum hours before next follow-up must occur"
    },
    "reasoning": {
      "type": "string",
      "description": "Minimum 100-word AI explanation of the score"
    },
    "competitor_alert": {
      "type": "boolean"
    },
    "competitor_details": {
      "type": ["string", "null"]
    },
    "financial_status": {
      "type": "string",
      "enum": ["own_funds", "loan_approved", "loan_pending", "loan_rejected", "unknown"]
    },
    "journey_stage": {
      "type": "integer",
      "minimum": 1,
      "maximum": 6
    },
    "score_trend": {
      "type": "string",
      "enum": ["improving", "stable", "declining"]
    },
    "previous_score": {
      "type": ["integer", "null"]
    },
    "score_change": {
      "type": ["integer", "null"]
    },
    "validation_flags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "requires_manager_review": {
      "type": "boolean"
    },
    "algorithm_version": {
      "type": "string"
    }
  }
}
```

---

## 20 Complete JSON Examples

### Example 1: HOT+ Referral Cash Buyer
```json
{
  "lead_id": "LD-2026-0047",
  "timestamp": "2026-06-08T09:15:00+05:30",
  "lead_score": { "total": 97, "breakdown": { "intent_score": 25, "engagement_score": 20, "urgency_score": 15, "financial_readiness": 15, "product_fit": 10, "competitive_risk": 5, "relationship_strength": 4, "sentiment_score": 3 } },
  "category": "HOT+", "purchase_probability": 0.97,
  "strengths": ["Referred by existing loyal customer", "Cash in hand confirmed ₹18L", "Walked in with cheque", "Specific variant requested", "Same-day booking intent stated"],
  "risks": ["Top variant stock — confirm immediately"],
  "missing_data_flags": [],
  "recommended_action": "Book an appointment within 1 hour. Confirm stock for requested variant. Prepare booking form and registration checklist now.",
  "follow_up_interval_hours": 2,
  "reasoning": "This is a referral customer with confirmed cash payment and self-declared same-day booking intent. The referral source is a loyal existing customer with a positive relationship, meaning pre-built trust is already present. Cheque-in-hand is the strongest physical financial signal possible. No competitive risk. No financial risk. No missing data. The only actionable task is confirming stock availability for the requested variant.",
  "competitor_alert": false, "competitor_details": null,
  "financial_status": "own_funds", "journey_stage": 5,
  "score_trend": "improving", "previous_score": null, "score_change": null,
  "validation_flags": [], "requires_manager_review": true, "algorithm_version": "1.0.0"
}
```

### Example 2: HOT Pre-Approved with Mild Competitor
```json
{
  "lead_id": "LD-2026-0082",
  "lead_score": { "total": 79, "breakdown": { "intent_score": 20, "engagement_score": 17, "urgency_score": 11, "financial_readiness": 13, "product_fit": 8, "competitive_risk": 3, "relationship_strength": 2, "sentiment_score": 5 } },
  "category": "HOT", "purchase_probability": 0.74,
  "strengths": ["Axis Bank loan pre-approved ₹14L", "Two showroom visits", "Test drive completed with positive feedback", "Highly positive WhatsApp tone"],
  "risks": ["Mentioned comparing with Kia Sonet — test drive with Kia scheduled for tomorrow"],
  "missing_data_flags": ["Preferred colour not confirmed"],
  "recommended_action": "Call today before Kia test drive. Send feature comparison document (your model vs Sonet). Highlight your after-sales service network advantage and total cost of ownership over 5 years.",
  "follow_up_interval_hours": 12,
  "reasoning": "Customer has a confirmed pre-approved loan which removes financial uncertainty. Two visits with completed positive test drive shows the product has been accepted. The Kia comparison is the primary risk — their Sonet test drive is scheduled for tomorrow. We must act before that test drive occurs, ideally with a comparison document that highlights specific advantages relevant to this customer's stated priorities (fuel economy and service cost).",
  "competitor_alert": true, "competitor_details": "Kia Sonet test drive scheduled 09-Jun-2026",
  "financial_status": "loan_approved", "journey_stage": 4,
  "score_trend": "stable", "previous_score": 76, "score_change": 3,
  "validation_flags": [], "requires_manager_review": false, "algorithm_version": "1.0.0"
}
```

### Example 3: WARM Budget Mismatch
```json
{
  "lead_id": "LD-2026-0156",
  "lead_score": { "total": 44, "breakdown": { "intent_score": 13, "engagement_score": 12, "urgency_score": 5, "financial_readiness": 4, "product_fit": 5, "competitive_risk": 3, "relationship_strength": 1, "sentiment_score": 1 } },
  "category": "WARM", "purchase_probability": 0.29,
  "strengths": ["Two visits", "High digital engagement", "Clear product preference identified"],
  "risks": ["Budget ₹9L vs desired variant on-road ₹16L (43% gap)", "No timeline", "Hostile tone in last call"],
  "missing_data_flags": ["Household decision-maker not identified"],
  "recommended_action": "Do not continue showing ₹16L variants. Reposition to appropriate segment. Present a comparison of what is available at ₹9–11L with a top-up loan scenario. Address hostile tone issue by assigning a different salesperson.",
  "follow_up_interval_hours": 96,
  "reasoning": "The financial mismatch is the primary barrier. Customer is engaged and has a genuine need, but the gap between aspirational and affordable is too large to bridge without product repositioning. Continuing to discuss higher variants creates false hope and will result in non-conversion. Sentiment score is at minimum due to hostile last call — this requires either a salesperson change or a cooling-off period before re-engagement.",
  "competitor_alert": true, "competitor_details": "Mentioned Hyundai Grand i10 as budget alternative",
  "financial_status": "unknown", "journey_stage": 2,
  "score_trend": "declining", "previous_score": 52, "score_change": -8,
  "validation_flags": ["DIMENSION_INCONSISTENCY_DETECTED"], "requires_manager_review": true, "algorithm_version": "1.0.0"
}
```

### Example 4: COLD Disengaged Long-Timeline
```json
{
  "lead_id": "LD-2026-0201",
  "lead_score": { "total": 21, "breakdown": { "intent_score": 5, "engagement_score": 4, "urgency_score": 2, "financial_readiness": 4, "product_fit": 3, "competitive_risk": 1, "relationship_strength": 1, "sentiment_score": 1 } },
  "category": "COLD", "purchase_probability": 0.10,
  "strengths": ["Initial enquiry submitted", "Responded once to WhatsApp"],
  "risks": ["Self-declared 8-month timeline", "No response to 4 subsequent calls", "No visit despite 3 invitations", "Budget unclear"],
  "missing_data_flags": ["Budget", "Preferred variant", "Loan status", "Family decision-maker"],
  "recommended_action": "Add to 14-day automated nurture sequence. No manual outreach until re-engagement detected. Set 30-day re-qualification trigger. If no engagement by 90 days, reclassify as DEAD.",
  "follow_up_interval_hours": 336,
  "reasoning": "The customer submitted an enquiry 6 weeks ago, responded to one WhatsApp message, and has been unresponsive since. Self-declared 8-month purchase timeline removes urgency. Insufficient data exists to assess financial readiness or product fit. No engagement pattern has been established. Manual follow-up would be an inefficient use of salesperson time at this stage.",
  "competitor_alert": false, "competitor_details": null,
  "financial_status": "unknown", "journey_stage": 1,
  "score_trend": "declining", "previous_score": 28, "score_change": -7,
  "validation_flags": [], "requires_manager_review": false, "algorithm_version": "1.0.0"
}
```

### Example 5: DEAD — Phone Invalid
```json
{
  "lead_id": "LD-2026-0319",
  "lead_score": { "total": 4, "breakdown": { "intent_score": 2, "engagement_score": 0, "urgency_score": 0, "financial_readiness": 0, "product_fit": 1, "competitive_risk": 1, "relationship_strength": 0, "sentiment_score": 0 } },
  "category": "DEAD", "purchase_probability": 0.01,
  "strengths": [],
  "risks": ["Phone number confirmed invalid (operator: number not in service)", "Email address not provided", "No physical address on record"],
  "missing_data_flags": ["INVALID_PHONE_NUMBER", "EMAIL_MISSING", "ADDRESS_MISSING"],
  "recommended_action": "Archive immediately. Mark as DEAD with reason: INVALID_CONTACT. Do not attempt further outreach. Log in fraud review queue for pattern analysis.",
  "follow_up_interval_hours": 8760,
  "reasoning": "All contact channels are unavailable. Phone number is confirmed out of service. No email. No address. This lead cannot be contacted and therefore cannot be progressed. The data pattern (no contact details provided) is consistent with either a test submission or competitive intelligence gathering. Archived with fraud review flag.",
  "competitor_alert": false,
  "financial_status": "unknown", "journey_stage": 1,
  "score_trend": "stable", "previous_score": null, "score_change": null,
  "validation_flags": ["PHONE_VALIDATION_FAILED", "INSUFFICIENT_CONTACT_DATA"], "requires_manager_review": true, "algorithm_version": "1.0.0"
}
```

### Examples 6–20 (Summary Format)

```json
[
  { "lead_id": "LD-006", "total": 91, "category": "HOT+", "purchase_probability": 0.91, "financial_status": "own_funds", "journey_stage": 5, "competitor_alert": false, "follow_up_interval_hours": 4, "recommended_action": "Prepare booking. Confirm specific variant stock. Call within 90 minutes." },
  { "lead_id": "LD-007", "total": 68, "category": "HOT", "purchase_probability": 0.63, "financial_status": "loan_approved", "journey_stage": 4, "competitor_alert": true, "follow_up_interval_hours": 18, "recommended_action": "Call before competitor test drive tomorrow. Send comparison document." },
  { "lead_id": "LD-008", "total": 82, "category": "HOT", "purchase_probability": 0.77, "financial_status": "own_funds", "journey_stage": 5, "competitor_alert": false, "follow_up_interval_hours": 8, "recommended_action": "Involve manager for final discount decision. Prepare paperwork." },
  { "lead_id": "LD-009", "total": 55, "category": "WARM", "purchase_probability": 0.36, "financial_status": "loan_pending", "journey_stage": 3, "competitor_alert": true, "follow_up_interval_hours": 72, "recommended_action": "Identify barrier (spouse approval pending). Invite both for joint visit." },
  { "lead_id": "LD-010", "total": 38, "category": "WARM", "purchase_probability": 0.24, "financial_status": "unknown", "journey_stage": 2, "competitor_alert": false, "follow_up_interval_hours": 120, "recommended_action": "7-day nurture. Send event invitation. Collect financial data on next interaction." },
  { "lead_id": "LD-011", "total": 74, "category": "HOT", "purchase_probability": 0.69, "financial_status": "loan_approved", "journey_stage": 4, "competitor_alert": false, "follow_up_interval_hours": 20, "recommended_action": "Follow up on variant decision. Pre-approved loan — only variant selection pending." },
  { "lead_id": "LD-012", "total": 89, "category": "HOT+", "purchase_probability": 0.89, "financial_status": "own_funds", "journey_stage": 5, "competitor_alert": false, "follow_up_interval_hours": 4, "recommended_action": "Cash buyer, 3rd visit, wife approved. Book appointment. Prepare documents." },
  { "lead_id": "LD-013", "total": 28, "category": "COLD", "purchase_probability": 0.13, "financial_status": "unknown", "journey_stage": 1, "competitor_alert": false, "follow_up_interval_hours": 240, "recommended_action": "14-day automated sequence. Requalify at 30 days." },
  { "lead_id": "LD-014", "total": 17, "category": "COLD", "purchase_probability": 0.08, "financial_status": "loan_rejected", "journey_stage": 2, "competitor_alert": false, "follow_up_interval_hours": 336, "recommended_action": "Explore NBFC and co-applicant. If rejected again, archive." },
  { "lead_id": "LD-015", "total": 8, "category": "DEAD", "purchase_probability": 0.02, "financial_status": "unknown", "journey_stage": 1, "competitor_alert": true, "follow_up_interval_hours": 4380, "recommended_action": "Archive. Competitor booking confirmed. Maintain goodwill for future." },
  { "lead_id": "LD-016", "total": 93, "category": "HOT+", "purchase_probability": 0.93, "financial_status": "own_funds", "journey_stage": 6, "competitor_alert": false, "follow_up_interval_hours": 2, "recommended_action": "Repeat customer upgrade. Fastest path to booking. High manager priority." },
  { "lead_id": "LD-017", "total": 61, "category": "WARM", "purchase_probability": 0.43, "financial_status": "loan_pending", "journey_stage": 3, "competitor_alert": true, "follow_up_interval_hours": 60, "recommended_action": "Counter Toyota comparison. Focus on feature value at this price point." },
  { "lead_id": "LD-018", "total": 76, "category": "HOT", "purchase_probability": 0.71, "financial_status": "loan_approved", "journey_stage": 4, "competitor_alert": false, "follow_up_interval_hours": 20, "recommended_action": "Variant decision pending. Send colour availability update. Call tomorrow." },
  { "lead_id": "LD-019", "total": 49, "category": "WARM", "purchase_probability": 0.31, "financial_status": "unknown", "journey_stage": 2, "competitor_alert": false, "follow_up_interval_hours": 96, "recommended_action": "Collect financial data. Invite for test drive. Missing data blocking accurate scoring." },
  { "lead_id": "LD-020", "total": 85, "category": "HOT+", "purchase_probability": 0.85, "financial_status": "own_funds", "journey_stage": 5, "competitor_alert": false, "follow_up_interval_hours": 6, "recommended_action": "Festival offer expiry tomorrow. Call now with final price. Manager on standby." }
]
```
