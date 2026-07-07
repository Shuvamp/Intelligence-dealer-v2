# LLM Scoring Rules, JSON Schema & Validation Framework
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## SECTION 11 — EDGE CASES

### 11.1 Multiple Test Drives But No Purchase

**Scenario:** A customer has test driven the car 3+ times over multiple weeks but has not moved to booking.

**What This Pattern Signals:**
This is one of the most diagnostically important edge cases. A customer who test drives repeatedly without progressing typically has one of these underlying states:
1. Unresolved financial issue (wants the car, cannot yet fund it)
2. Unresolved family objection (wants the car, someone at home doesn't agree)
3. Genuine indecision between two products (yours and a competitor's)
4. Waiting for a specific event (salary, bonus, end of lease on current car)
5. Enjoying the experience with no real purchase intent

**AI Scoring Logic:**
- First test drive: +8 (Intent signal)
- Second test drive: +9 (reinforcement, nearly always a positive indicator)
- Third test drive without booking: -4 (pattern recognition trigger; something is blocking)
- Fourth test drive: -8 (chronic indecision or non-serious browser pattern confirmed)

**Net Score Effect:** Positive up to test drive 2; declining thereafter without booking progression.

**AI Recommended Action:** After a third test drive without booking, the AI must trigger a "barrier identification call" — a structured conversation specifically designed to uncover what is preventing the purchase. The salesperson should not attempt another standard follow-up; they need to ask directly: "You've driven this car three times and you clearly love it. What's the one thing that's holding you back?"

---

### 11.2 High Engagement But Low Budget

**Scenario:** A customer is deeply engaged (multiple visits, WhatsApp active, test drive completed) but their confirmed budget is significantly below the on-road price of the models they are interested in.

**Scoring Logic:**
- Engagement Score: High (15–18/20 based on activity)
- Financial Readiness Score: Low (3–5/15 based on gap)
- Overall Score: Artificially inflated by engagement unless financial constraint is weighted correctly

**AI Rule:** Financial readiness score has a **veto weight** in this scenario. Even if engagement score is maximum, a confirmed budget gap >30% of vehicle price caps the overall score at 50 maximum.

**Example:**
Customer is extremely responsive, visited 4 times, test drove twice. But their stated budget is ₹9 lakh and the variant they want is ₹16 lakh on-road. Score would be: Engagement 18/20, but Financial Readiness 3/15, Intent 12/25 (intent for a car they can't afford is partially discounted). Total: ~55/100 maximum.

**AI Recommended Action:** Reposition immediately. Do not continue showing the customer cars they cannot afford. Present alternatives within their budget with a side-by-side comparison showing what they can get versus what they want.

---

### 11.3 Rich Customer But No Urgency

**Scenario:** Customer clearly has the financial capacity (high income, confirmed own funds) but shows no urgency and is taking an extended, leisurely approach to the decision.

**Scoring Logic:**
- Financial Readiness: High (12–15/15)
- Urgency Score: Very low (2–4/15)
- Net effect: Strong financial capacity does not compensate for zero urgency

**AI Rule:** Do NOT create artificial pressure for high-net-worth customers. Aggressive follow-up is the fastest way to lose this category of buyer. They respond poorly to urgency tactics because they experience it as disrespect.

**Recommended approach:** Premium service, information richness, no-pressure engagement. These customers will convert when they are ready. Your job is to be their first choice when they arrive at that readiness.

**Score cap:** Financial readiness without urgency caps overall score at 65/100 regardless of other strong signals.

---

### 11.4 Competitor Booking But Still Evaluating

**Scenario:** Customer has placed a booking with a competitor but is "still looking" or unhappy with the competitor's service/delivery experience.

**AI Analysis:**
This is a rare but recoverable scenario. The key question is: **Is this a genuine reconsideration or courtesy shopping?**

**Genuine reconsideration signals:**
- Customer mentions a specific complaint about competitor service (long wait, poor communication, delivery delay)
- Customer is requesting a comparison of your product against the competitor product they booked
- Customer asks what your delivery timeline would be vs. competitor's delayed delivery

**Scoring:** Start at 20 (booking with competitor = major deduction), then apply positive signals from reconsideration behaviour.
- Specific complaint about competitor: +10
- Requested comparison document: +7
- Asked about your delivery timeline: +8

Maximum recovery score: ~55/100 — treat as WARM with HOT potential if competitor delivery continues to deteriorate.

**AI Recommended Action:** Do NOT try to rush this customer. Be genuinely helpful, acknowledge the difficulty of their situation, and make your advantages clear without attacking the competitor. If their competitor delivery is delayed significantly, have a ready "we can deliver in X days" offer prepared.

---

### 11.5 Family Disagreement

**Scenario:** During a visit, it becomes clear that different family members have different brand/model preferences, or one family member is strongly opposed to the purchase.

**Impact Categories:**

**Spouse Disagreement:**
- Deduction: -8 to -12 depending on severity
- If spouse expressed disapproval verbally: -10
- If spouse is clearly the dominant financial decision-maker: -12
- AI Action: Invite both partners explicitly. Identify the specific objection. If it's a feature concern, address with data. If it's emotional/brand preference, address with test drive.

**Parent Disapproval:**
- In multi-generational households, parental disapproval (especially about budget) can block a purchase even when the buyer is financially independent.
- Deduction: -6 to -9
- AI Action: Ask the customer what concerns their parents have raised and provide data-backed answers they can share.

**Children's Influence:**
- Adult children helping parents evaluate: generally a positive signal (they are likely digitally informed and will research thoroughly)
- Minor children in the showroom causing the visit to be cut short: treat as situational, do not penalise

---

### 11.6 Corporate Purchase

**Scoring Adjustments for Corporate:**
Corporate purchases have fundamentally different decision dynamics than individual retail purchases.

| Factor | Individual | Corporate |
|--------|-----------|-----------|
| Decision-makers | 1–3 | 3–7 (purchase team, finance, MD) |
| Timeline | 1–6 weeks | 4–12 weeks |
| Primary driver | Emotion + function | Function + tax/compliance |
| Urgency triggers | Personal life events | Financial year end, budget cycle |
| Negotiation style | Relational | Structured/formal |

**Corporate Scoring Model Adjustments:**
- Replace "Urgency Score" with "Procurement Stage Score"
- Add "Decision Stakeholder Coverage" as a new 5-point dimension
- Financial readiness is near-certain if company has budget approval; score 14/15
- The key risk is stakeholder alignment, not individual intent

---

### 11.7 Fleet Purchase (5+ Vehicles)

Fleet purchases require a dedicated sub-process. The scoring model is not designed for fleet — however, the AI should flag fleet enquiries immediately for dedicated fleet team assignment.

**Fleet Lead Indicators:**
- Customer asks about pricing for 3+ vehicles
- Customer mentions a company name and fleet requirement
- Customer asks about corporate invoice, GST benefits, or fleet maintenance contracts

**AI Action on Detection:** Immediately tag as FLEET lead and route to fleet sales manager. Do not attempt to process through standard lead scoring pipeline. Standard score: mark as 75/100 pending fleet manager qualification.

---

## SECTION 12 — LLM REASONING RULES

### 12.1 Core Principles for AI Scoring

The AI agent (Claude or GPT-based) performing lead scoring must adhere to the following non-negotiable reasoning rules:

**Rule 1: Evidence-Only Scoring**
Every point awarded or deducted must be traceable to a specific interaction record, CRM log entry, call recording transcript, or explicitly stated customer data. The AI must never infer positive intent beyond what the evidence supports.

> ✅ CORRECT: "Customer requested a test drive on 06-Jun-2026 per CRM log. Score +8 (test drive request signal)."
> ❌ WRONG: "Customer seems serious based on general tone. Score +10."

**Rule 2: Uncertainty Flagging**
When the AI has insufficient data to score a dimension, it must flag the uncertainty explicitly rather than defaulting to a neutral score.

> ✅ CORRECT: "Financial Readiness Score: INSUFFICIENT DATA. Customer has not provided income, budget, or loan preference information. Score defaulted to 5/15 pending data collection. Recommend salesperson ask financial qualification questions on next interaction."
> ❌ WRONG: "Financial Readiness: 8/15" (with no supporting data)

**Rule 3: Contradiction Identification**
When a customer's stated intent contradicts their observed behaviour, the AI must flag the contradiction and explain which signal it is weighting and why.

> Example: "Customer stated 'I'm in no hurry' (urgency -6). However, customer has visited 3 times in 8 days and asked about stock availability for a specific colour (urgency +5). AI is weighting behaviour over statement per standard protocol. Net urgency: behavioural urgency overrides verbal denial."

**Rule 4: Anti-Hallucination Checks**
The AI must never generate interaction data that does not exist in the CRM. If a field is empty, it must be reported as empty, not assumed.

> ❌ WRONG: "Customer likely has a good credit score given their profession as an engineer."
> ✅ CORRECT: "Credit score not on file. Profession: software engineer, salary ₹85,000 per CRM. Loan pre-approval status: NOT RECORDED. Recommend pre-screening before committing delivery date."

**Rule 5: Score Transparency**
Every score output must include a breakdown by dimension with the specific evidence for each dimension's score.

**Rule 6: Temporal Awareness**
The AI must apply the recency decay function to all engagement signals. An engagement that occurred 45 days ago must be scored at 25% of its original value.

**Rule 7: Dimension Independence**
Each scoring dimension must be evaluated independently before being summed. The AI must not allow a very high engagement score to "spill over" and inflate intent or financial scores.

**Rule 8: Competitor Risk Must Always Be Evaluated Last**
Competitive risk is a modifier, not a primary score. It should be evaluated only after all other dimensions are scored, and applied as a final adjustment.

---

### 12.2 LLM Scoring Prompt Template

```
You are an automotive lead scoring AI for a dealership CRM system.

Your task is to score a lead out of 100 points using the following dimensions:
1. Intent Score (max 25)
2. Engagement Score (max 20)
3. Urgency Score (max 15)
4. Financial Readiness (max 15)
5. Product Fit (max 10)
6. Competitive Risk (max 5)
7. Relationship Strength (max 5)
8. Sentiment Score (max 5)

RULES:
- Score only based on evidence in the interaction log provided.
- If data is missing for a dimension, flag it as INSUFFICIENT DATA and use minimum score (0–2).
- Apply recency decay: interactions >30 days ago = 50% of score value.
- Flag all contradictions between stated intent and observed behaviour.
- Do not assume positive intent without supporting evidence.
- Output must include dimension-by-dimension breakdown with evidence citations.

CUSTOMER DATA:
[CUSTOMER_PROFILE]

INTERACTION HISTORY:
[INTERACTION_LOG]

Produce a JSON output per the standard schema.
```

---

### 12.3 LLM Scoring Examples

**Example A: HOT+ Customer**

Input interaction log:
```
06-Jun: Walk-in visit. Brought wife. 45-minute showroom stay.
07-Jun: WhatsApp: "My wife liked the car. Can you tell me when the white top variant will be ready for delivery?"
07-Jun: Called dealership at 5:30 PM. Asked about registration process.
08-Jun: Visited again. Asked for final on-road price. Said "we'll do it by this weekend."
```

AI Output:
```json
{
  "lead_score": 91,
  "category": "HOT+",
  "purchase_probability": 0.90,
  "strengths": [
    "Two walk-in visits within 3 days",
    "Spouse accompanied and approved",
    "Proactive inbound call about registration",
    "Explicit booking declaration: this weekend",
    "Specific variant and colour confirmed (white top)"
  ],
  "risks": [
    "Delivery timeline for white top variant must be confirmed",
    "No financial data on file yet"
  ],
  "recommended_action": "Call within 2 hours. Confirm white top variant stock. Prepare complete on-road price quotation. Have booking form and finance manager ready. Do not introduce new options.",
  "reasoning": "Customer exhibits Stage 5 (Negotiation) behaviour across all signals. Wife approval removes the most common household veto risk. Proactive registration call confirms mental commitment to transaction. Booking timeline is self-declared and specific. Only gap is financial confirmation — complete loan or cash verification before celebrating."
}
```

---

**Example B: WARM Customer With Budget Risk**

```json
{
  "lead_score": 48,
  "category": "WARM",
  "purchase_probability": 0.30,
  "strengths": [
    "Two showroom visits",
    "Test drive completed",
    "Responsive on WhatsApp"
  ],
  "risks": [
    "Budget stated (₹9L) is ₹7L below desired variant on-road price (₹16L)",
    "No timeline mentioned",
    "Competitor comparison active (Kia Seltos)"
  ],
  "recommended_action": "Do not continue showing ₹16L variants. Reposition to budget-appropriate alternatives. Present comparison between what is available at ₹9L vs ₹11L (with top-up loan). Allow customer to expand budget organically rather than pushing.",
  "reasoning": "Financial Readiness score is capped at 4/15 due to confirmed ₹7L gap (44% of target price). Engagement signals are positive but cannot override fundamental financial mismatch. Repositioning to budget-aligned options is the only ethical and commercially viable path."
}
```

---

## SECTION 13 — JSON OUTPUT STANDARD

### Master Schema Definition

```json
{
  "schema_version": "1.0",
  "lead_id": "string (UUID)",
  "timestamp": "ISO 8601 datetime",
  "salesperson_id": "string",
  "lead_score": {
    "total": "integer (0–100)",
    "breakdown": {
      "intent_score": "integer (0–25)",
      "engagement_score": "integer (0–20)",
      "urgency_score": "integer (0–15)",
      "financial_readiness": "integer (0–15)",
      "product_fit": "integer (0–10)",
      "competitive_risk": "integer (0–5)",
      "relationship_strength": "integer (0–5)",
      "sentiment_score": "integer (0–5)"
    }
  },
  "category": "string (HOT+|HOT|WARM|COLD|DEAD)",
  "purchase_probability": "float (0.00–1.00)",
  "strengths": ["array of string"],
  "risks": ["array of string"],
  "missing_data_flags": ["array of string"],
  "recommended_action": "string",
  "follow_up_interval_hours": "integer",
  "reasoning": "string (min 100 words)",
  "competitor_alert": "boolean",
  "competitor_details": "string or null",
  "financial_status": "string (own_funds|loan_approved|loan_pending|loan_rejected|unknown)",
  "journey_stage": "integer (1–6)",
  "score_trend": "string (improving|stable|declining)",
  "previous_score": "integer or null",
  "score_change": "integer or null"
}
```

---

### 20 JSON Output Examples

**JSON-001: HOT+ Cash Buyer**
```json
{
  "lead_id": "LD-2026-001847",
  "timestamp": "2026-06-08T10:32:00+05:30",
  "lead_score": { "total": 93, "breakdown": { "intent_score": 24, "engagement_score": 19, "urgency_score": 13, "financial_readiness": 15, "product_fit": 10, "competitive_risk": 5, "relationship_strength": 4, "sentiment_score": 3 } },
  "category": "HOT+",
  "purchase_probability": 0.92,
  "strengths": ["Cash payment confirmed", "3 visits in 6 days", "Wife approved", "Specific variant locked"],
  "risks": ["Delivery ETA for specific colour not yet confirmed"],
  "missing_data_flags": [],
  "recommended_action": "Call within 1 hour. Confirm stock for preferred colour. Prepare booking form and registration checklist.",
  "follow_up_interval_hours": 4,
  "reasoning": "Customer has confirmed cash payment capacity and has self-declared booking intent. All key household decision-makers have visited and approved. Product specificity is high (exact variant and colour chosen). The only remaining operational item is stock confirmation. No financial risk. No competitive risk.",
  "competitor_alert": false,
  "competitor_details": null,
  "financial_status": "own_funds",
  "journey_stage": 5,
  "score_trend": "improving",
  "previous_score": 78,
  "score_change": 15
}
```

**JSON-002: HOT Pre-Approved Loan**
```json
{
  "lead_id": "LD-2026-002104",
  "lead_score": { "total": 82, "breakdown": { "intent_score": 21, "engagement_score": 16, "urgency_score": 11, "financial_readiness": 13, "product_fit": 9, "competitive_risk": 4, "relationship_strength": 3, "sentiment_score": 5 } },
  "category": "HOT",
  "purchase_probability": 0.75,
  "strengths": ["HDFC loan pre-approved ₹15L", "Test drive completed", "Positive post-drive feedback", "Comparing only 2 variants (not brands)"],
  "risks": ["Still comparing between two variants internally", "No explicit booking statement yet"],
  "missing_data_flags": ["Preferred variant not yet confirmed"],
  "recommended_action": "Send side-by-side variant comparison for the two variants she is evaluating. Call tomorrow morning. Introduce finance manager to confirm loan terms.",
  "follow_up_interval_hours": 20,
  "reasoning": "Pre-approved loan removes the primary financial uncertainty. Test drive completed with positive feedback. The only decision remaining is variant selection. This is a Stage 3–4 customer who needs one more focussed interaction to advance to negotiation.",
  "competitor_alert": false,
  "financial_status": "loan_approved",
  "journey_stage": 4,
  "score_trend": "improving",
  "previous_score": 67,
  "score_change": 15
}
```

**JSON-003: WARM With Competitor Risk**
```json
{
  "lead_id": "LD-2026-003217",
  "lead_score": { "total": 52, "breakdown": { "intent_score": 14, "engagement_score": 12, "urgency_score": 6, "financial_readiness": 8, "product_fit": 7, "competitive_risk": 2, "relationship_strength": 1, "sentiment_score": 2 } },
  "category": "WARM",
  "purchase_probability": 0.32,
  "strengths": ["Two showroom visits", "Test drive completed", "Loan-eligible profile (salary confirmed)"],
  "risks": ["Actively evaluating Hyundai Creta (test drove yesterday)", "No booking timeline stated", "Spouse has not visited"],
  "missing_data_flags": ["Spouse preference unknown", "Exact budget not stated"],
  "recommended_action": "Send a feature comparison document (your model vs Creta) focussed on the specific dimensions this customer values. Do not push for booking. Invite spouse for a joint test drive.",
  "follow_up_interval_hours": 48,
  "competitor_alert": true,
  "competitor_details": "Customer test drove Hyundai Creta at Hyundai dealership on 07-Jun-2026. Competitor risk: MEDIUM.",
  "financial_status": "loan_pending",
  "journey_stage": 3,
  "score_trend": "stable",
  "previous_score": 54,
  "score_change": -2
}
```

**JSON-004: COLD Disengaged**
```json
{
  "lead_id": "LD-2026-004091",
  "lead_score": { "total": 19, "breakdown": { "intent_score": 4, "engagement_score": 3, "urgency_score": 2, "financial_readiness": 4, "product_fit": 3, "competitive_risk": 1, "relationship_strength": 1, "sentiment_score": 1 } },
  "category": "COLD",
  "purchase_probability": 0.08,
  "strengths": ["Initial enquiry shows product awareness"],
  "risks": ["No response in 21 days", "12-month purchase timeline stated", "Budget unclear"],
  "missing_data_flags": ["Budget", "Preferred variant", "Loan status", "Family involvement"],
  "recommended_action": "Add to 14-day automated nurture sequence. No manual follow-up until re-engagement observed. Re-qualify at 30-day mark.",
  "follow_up_interval_hours": 336,
  "reasoning": "Customer has not responded to 4 outreach attempts over 21 days. Self-declared 12-month timeline removes urgency. Insufficient data to assess financial readiness. Automated nurture is the only appropriate action.",
  "competitor_alert": false,
  "financial_status": "unknown",
  "journey_stage": 1,
  "score_trend": "declining",
  "previous_score": 28,
  "score_change": -9
}
```

**JSON-005: DEAD LEAD — Competitor Booking Confirmed**
```json
{
  "lead_id": "LD-2026-005554",
  "lead_score": { "total": 6, "breakdown": { "intent_score": 0, "engagement_score": 2, "urgency_score": 0, "financial_readiness": 1, "product_fit": 0, "competitive_risk": 0, "relationship_strength": 2, "sentiment_score": 1 } },
  "category": "DEAD",
  "purchase_probability": 0.02,
  "strengths": ["Customer was friendly during interactions; goodwill maintained"],
  "risks": ["Confirmed Tata Nexon EV booking on 05-Jun-2026", "Delivery scheduled for 20-Jun-2026"],
  "missing_data_flags": [],
  "recommended_action": "Archive lead. Send a congratulatory WhatsApp message on their new car. Add to 6-month re-activation list for next vehicle consideration.",
  "follow_up_interval_hours": 4380,
  "reasoning": "Customer confirmed Nexon EV booking with delivery date. Transaction is complete with competitor. No commercially viable path to conversion for this purchase. Maintaining goodwill is the only actionable objective — a well-handled exit creates a referral and future customer opportunity.",
  "competitor_alert": true,
  "competitor_details": "Tata Nexon EV booked 05-Jun-2026. Delivery 20-Jun-2026.",
  "financial_status": "own_funds",
  "journey_stage": 6,
  "score_trend": "declining",
  "previous_score": 68,
  "score_change": -62
}
```

**JSON-006 through JSON-020: Category Summary**

```json
{ "lead_id": "LD-006", "lead_score": { "total": 88 }, "category": "HOT+", "purchase_probability": 0.88, "recommended_action": "Prepare booking documents. Manager call scheduled.", "journey_stage": 5 }
{ "lead_id": "LD-007", "lead_score": { "total": 44 }, "category": "WARM", "purchase_probability": 0.28, "recommended_action": "Reposition to budget-aligned models. No pressure.", "journey_stage": 2 }
{ "lead_id": "LD-008", "lead_score": { "total": 71 }, "category": "HOT", "purchase_probability": 0.68, "recommended_action": "Counter Kia competitor with feature comparison. Test drive offer.", "journey_stage": 3 }
{ "lead_id": "LD-009", "lead_score": { "total": 95 }, "category": "HOT+", "purchase_probability": 0.95, "recommended_action": "Referral customer with cash. Immediate booking appointment.", "journey_stage": 5 }
{ "lead_id": "LD-010", "lead_score": { "total": 33 }, "category": "WARM", "purchase_probability": 0.20, "recommended_action": "7-day nurture. Invite to upcoming event.", "journey_stage": 2 }
{ "lead_id": "LD-011", "lead_score": { "total": 78 }, "category": "HOT", "purchase_probability": 0.74, "recommended_action": "Final price quotation. Include manager discount authority.", "journey_stage": 4 }
{ "lead_id": "LD-012", "lead_score": { "total": 12 }, "category": "DEAD", "purchase_probability": 0.03, "recommended_action": "Archive. No follow-up.", "journey_stage": 1 }
{ "lead_id": "LD-013", "lead_score": { "total": 61 }, "category": "WARM", "purchase_probability": 0.40, "recommended_action": "Involve missing spouse. Joint test drive invitation.", "journey_stage": 3 }
{ "lead_id": "LD-014", "lead_score": { "total": 83 }, "category": "HOT", "purchase_probability": 0.80, "recommended_action": "Address ergonomic concern. One more demonstration. Close.", "journey_stage": 4 }
{ "lead_id": "LD-015", "lead_score": { "total": 46 }, "category": "WARM", "purchase_probability": 0.30, "recommended_action": "Set reactivation trigger for bonus date.", "journey_stage": 2 }
{ "lead_id": "LD-016", "lead_score": { "total": 91 }, "category": "HOT+", "purchase_probability": 0.91, "recommended_action": "Closing conversation today. Prepare tax documentation.", "journey_stage": 5 }
{ "lead_id": "LD-017", "lead_score": { "total": 24 }, "category": "COLD", "purchase_probability": 0.12, "recommended_action": "14-day automated nurture sequence.", "journey_stage": 1 }
{ "lead_id": "LD-018", "lead_score": { "total": 67 }, "category": "HOT", "purchase_probability": 0.62, "recommended_action": "Fleet pricing conversation. Involve fleet manager.", "journey_stage": 3 }
{ "lead_id": "LD-019", "lead_score": { "total": 56 }, "category": "WARM", "purchase_probability": 0.38, "recommended_action": "EV total cost of ownership comparison. Infrastructure check.", "journey_stage": 3 }
{ "lead_id": "LD-020", "lead_score": { "total": 37 }, "category": "WARM", "purchase_probability": 0.22, "recommended_action": "Identify blocking barrier. Direct question on next call.", "journey_stage": 3 }
```

---

## SECTION 14 — VALIDATION FRAMEWORK

### 14.1 Score Inflation Prevention

**Problem:** Sales personnel may be tempted to manually inflate scores to make their pipeline appear healthier than it is, or to retain WARM leads as HOT to justify continued time investment.

**Controls:**

**Rule V-01: Evidence Citation Requirement**
Every score above 70 must have a minimum of 5 distinct evidence citations in the CRM interaction log. If fewer than 5 citations exist, the system automatically caps the score at 65 and flags for manager review.

**Rule V-02: Dimension Consistency Check**
If any two dimensions have a score difference greater than 15 points, the system flags it for review. For example: Engagement Score of 19/20 but Intent Score of 3/25 is internally inconsistent and requires explanation.

**Rule V-03: Mandatory Financial Data Gate**
A lead cannot score above 75 unless financial readiness data (budget, loan status, or income indication) has been recorded. If financial data is absent, maximum score is automatically capped at 74.

**Rule V-04: Test Drive Verification**
Test drive scores (+8 to +10) can only be applied if there is a corresponding test drive log entry in the CRM with date, time, vehicle, and salesperson ID. Self-reported test drives without system log are not scored.

**Rule V-05: Recency Enforcement**
The scoring algorithm automatically applies recency decay to all engagement signals. No manual override of recency decay is permitted.

---

### 14.2 Score Manipulation Prevention

**Problem:** Manipulation occurs when salespeople add fabricated interactions, duplicate customers, or misrepresent customer statements to inflate scores.

**Controls:**

**Rule V-06: Call Recording Cross-Reference**
For any lead scoring a call-based engagement (+3 or above), the system checks for a corresponding call recording or call log entry. If absent, the engagement score is quarantined pending manager verification.

**Rule V-07: Duplicate Lead Detection**
The system runs daily duplicate detection using fuzzy matching on:
- Name + phone number
- Name + email
- Phone number alone (with different names)
When a duplicate is detected, scores are merged per the most recent interaction. Discrepancies between duplicate records are flagged.

**Rule V-08: IP and Device Footprint for Digital Engagement**
Website engagement scores are validated against analytics platform data. If CRM shows 10 website visits but analytics shows 2, the analytics data prevails and the CRM record is flagged for review.

**Rule V-09: Timestamp Auditing**
All CRM entries are timestamped server-side. Client-side timestamp manipulation is not possible. Any entry added retroactively (more than 48 hours after the stated interaction date) is automatically flagged as a potential retroactive entry.

**Rule V-10: Manager Approval for Score Override**
If a salesperson manually changes a system-computed score by more than 10 points in either direction, the change is logged as a manual override and requires manager approval within 24 hours. Unapproved overrides revert automatically.

---

### 14.3 Salesperson Bias Prevention

**Problem:** Salespeople tend to score leads from customers they like higher, and leads from difficult customers lower, regardless of actual purchase intent.

**Controls:**

**Rule V-11: Blind Scoring Option**
For high-value leads (budget >₹20L), the AI score is computed before the salesperson's notes are revealed to the scoring algorithm. The AI scores the objective data first; subjective notes are shown separately and tagged as "salesperson assessment" rather than being incorporated into the score.

**Rule V-12: Sentiment Score Separation**
The sentiment score dimension is maintained separately from the primary 95 points. It cannot influence other dimension scores. A difficult customer is not a low-intent customer.

**Rule V-13: Periodic Salesperson Calibration**
Each salesperson's average lead score for leads they managed that converted to sales is benchmarked against their average score for leads that did not convert. Salespeople who chronically over-score non-converting leads are flagged for calibration coaching.

**Rule V-14: Anonymous Review Queue**
5% of scored leads are randomly selected for anonymous review by a second salesperson. Score discrepancies of >15 points are investigated.

---

### 14.4 Missing Information Handling

**Problem:** Incomplete lead profiles result in unreliable scores.

**Controls:**

**Rule V-15: Minimum Data Threshold**
A lead cannot be scored until a minimum data set is present:
- Customer name ✓
- Phone number (verified) ✓
- At least one interaction logged ✓
- Product interest noted ✓

Leads below this threshold are marked as "Unscored — Data Incomplete" and added to a data-collection workflow.

**Rule V-16: Missing Data Flags in Output**
The JSON output schema includes a `missing_data_flags` array. If financial data, competitor information, or household decision-maker data is absent, the array is populated and the recommended action includes data collection as the first priority.

**Rule V-17: Progressive Data Collection Scoring Incentive**
Salesperson dashboards display a "Data Quality Score" for each lead alongside the lead score. Higher data completeness = higher confidence in the AI score. This creates an incentive for thorough data entry.

---

### 14.5 Duplicate Lead Controls

**Problem:** Duplicate leads waste resources and create conflicting interaction histories.

**Controls:**

**Rule V-18: Real-Time Duplicate Alert**
When a new lead is created, the system performs real-time fuzzy matching against existing records. If a match probability exceeds 85%, the system alerts the creating user before the record is saved.

**Rule V-19: Cross-Channel Deduplication**
Leads from website forms, WhatsApp clicks, walk-in logs, and inbound calls are all deduplicated against the same master customer database using phone number as primary key and name + email as secondary keys.

**Rule V-20: Duplicate Resolution Protocol**
When two records are confirmed as duplicates:
1. Interaction histories are merged chronologically.
2. The highest score from either record is retained as the base.
3. A flag is placed noting the merge for audit purposes.
4. Both original salesperson IDs are retained for commission attribution purposes.

**Rule V-21: Platform-Level Deduplication Audit**
A monthly deduplication audit is run across the entire customer database. Records that share phone numbers but have different names are reviewed for identity verification. The findings are reported to the dealership principal monthly.

---

### 14.6 Enterprise Audit and Compliance Controls

**Rule V-22: Full Score History Retention**
Every score computation is retained permanently in the audit log with: timestamp, inputs, algorithm version used, output, and any manual overrides applied. This log is immutable.

**Rule V-23: Algorithm Version Tracking**
Every score in the system is tagged with the algorithm version that produced it. When the scoring model is updated, all existing scores are flagged as computed under the prior version until they are recomputed.

**Rule V-24: Regulatory Data Privacy Compliance**
All customer personal data used in scoring (phone, income, address) is processed per applicable data privacy regulations. The scoring model operates on anonymised records in the ML training pipeline. Production scoring never shares PII with external systems without explicit consent logging.

**Rule V-25: Score Model Performance Tracking**
A monthly performance report is generated showing:
- Average score of converted leads (should be significantly higher than non-converted)
- Score distribution by category (HOT+/HOT/WARM/COLD/DEAD)
- False positive rate: HOT+ leads that did not convert
- False negative rate: COLD leads that converted unexpectedly
- Score accuracy improvement over time with ML feedback loop

This report is reviewed by the dealership principal and CRM administrator monthly and used to recalibrate scoring weights where drift is identified.
