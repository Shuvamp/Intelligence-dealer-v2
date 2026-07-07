# Validation Framework
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## Overview

The validation framework is the enterprise-grade control layer that protects the integrity of the lead scoring system. Without validation, AI scores drift away from objective measurement and become reflections of CRM data quality failures, salesperson optimism bias, and deliberate manipulation. The 25 rules below are non-negotiable and are enforced at the system level.

---

## CATEGORY 1 — SCORE INFLATION PREVENTION (Rules V-01 to V-05)

### Rule V-01: Evidence Citation Requirement

**Problem:** Salespeople enter vague, unverified notes to support high scores without real engagement evidence.

**Rule:** Every lead scoring above 70 must have a minimum of 5 distinct, timestamped evidence entries in the CRM interaction log. If fewer than 5 entries exist, the system automatically caps the score at 65 and raises a `SCORE_CAP_APPLIED` flag.

**Implementation:**
```
IF lead.total_score > 70 AND COUNT(lead.interaction_log) < 5:
    lead.total_score = MIN(lead.total_score, 65)
    lead.validation_flags.append("SCORE_CAP_APPLIED: INSUFFICIENT_EVIDENCE")
    lead.requires_manager_review = True
```

**Audit Log:** Every cap applied is written to the immutable audit log with timestamp, original score, capped score, and evidence count at time of application.

---

### Rule V-02: Dimension Consistency Check

**Problem:** A lead with high engagement but zero intent being scored as HOT is internally inconsistent and suggests either data error or manipulation.

**Rule:** If any two core dimensions (intent, engagement, urgency, financial readiness) differ by more than the equivalent of 50% of their maximum value when normalised to a 100-point scale, the system flags a `DIMENSION_INCONSISTENCY` and requires a supervisory note before the score is published to the salesperson dashboard.

**Example Trigger:**
- Engagement Score: 19/20 (normalised: 95%)
- Intent Score: 3/25 (normalised: 12%)
- Difference: 83% — far exceeds the 50% threshold
- Result: Flag raised; score quarantined pending review

**Legitimate Exception:** Engagement can lead intent for first-visit customers who have not yet declared purchase intent. The AI must suppress the flag for leads with only 1 or 2 interactions total.

---

### Rule V-03: Financial Data Gate

**Problem:** Leads are scored high without any financial data, resulting in HOT categorisation for customers who may be completely unqualified to purchase.

**Rule:** A lead cannot receive a total score above 75 unless at least one of the following financial data points is recorded:
- Stated or confirmed budget amount
- Loan pre-approval status
- Employment type and approximate income
- Payment method preference (cash/EMI)

**If financial data is absent:**
```
IF financial_data_fields_populated == 0:
    lead.total_score = MIN(lead.total_score, 74)
    lead.missing_data_flags.append("FINANCIAL_DATA_MISSING")
    lead.recommended_action = prepend("PRIORITY: Collect financial profile before next engagement. " + existing_action)
```

---

### Rule V-04: Test Drive Verification

**Problem:** Salespeople mark test drives as completed without a corresponding system log entry, to inflate engagement and intent scores.

**Rule:** Test drive score bonuses (+8 to +10) can only be applied when a corresponding test drive log entry exists in the vehicle management system with: date, time, vehicle registration number, salesperson ID, and customer signature (digital or physical).

**Self-reported test drives** (notes only, no system entry) are scored at 40% of standard value and flagged: `TEST_DRIVE_UNVERIFIED`.

**Audit Behaviour:** Any discrepancy between CRM test drive claims and the vehicle management system log is automatically flagged for the branch manager.

---

### Rule V-05: Recency Decay Enforcement

**Problem:** Old engagements are treated as fresh signals, artificially inflating scores for leads that have gone cold.

**Rule:** The scoring algorithm applies recency decay automatically and server-side. No manual override of recency decay factors is permitted by any user role including administrator. The decay function is:

```python
def recency_decay(interaction_date: datetime) -> float:
    days_ago = (datetime.now() - interaction_date).days
    if days_ago <= 7:   return 1.00
    if days_ago <= 14:  return 0.75
    if days_ago <= 30:  return 0.50
    if days_ago <= 60:  return 0.25
    return 0.10
```

All engagement scores older than 90 days contribute at most 10% of their original value. This means a lead that was HOT 3 months ago and has had no engagement will naturally decay toward COLD without any manual intervention.

---

## CATEGORY 2 — SCORE MANIPULATION PREVENTION (Rules V-06 to V-10)

### Rule V-06: Call Recording Cross-Reference

**Problem:** Salespeople log calls as "positive meaningful engagement" when the customer was disinterested, said very little, or was not actually reached.

**Rule:** For any interaction earning +3 or more engagement points via a call, the system checks for a corresponding call log entry (auto-generated from CRM telephony integration or call centre dialler). If no call log entry exists, the engagement credit is quarantined:

```
IF interaction.type == "outbound_call" AND interaction.engagement_score_claimed >= 3:
    IF NOT call_log_exists(interaction.date, interaction.salesperson_id):
        interaction.score = interaction.score * 0.0  # Quarantined
        validation_flags.append("CALL_LOG_MISSING: SCORE_QUARANTINED")
```

**Exception:** Manual entry with attached audio recording is accepted as evidence.

---

### Rule V-07: Duplicate Lead Detection

**Problem:** The same customer is logged as multiple separate leads, multiplying the apparent pipeline and potentially assigning two salespeople to the same prospect.

**Rule:** The system runs a daily duplicate detection pass using fuzzy matching across:
1. Phone number (primary key — exact match required)
2. Name + city (secondary — fuzzy match, 85% similarity threshold)
3. Email address (tertiary — exact match)

When a match probability exceeds 85%, both records are flagged and the creating user is notified. The records are not automatically merged (to protect interaction history integrity), but both are tagged `POTENTIAL_DUPLICATE` until a human resolves the conflict.

---

### Rule V-08: Digital Engagement Validation

**Problem:** Website visit counts logged in CRM may be inflated or fabricated if manually entered rather than pulled from the analytics platform.

**Rule:** Website engagement scores are validated against the dealership's analytics platform (Google Analytics, dealer portal analytics) weekly. If CRM shows 10+ website visits but the analytics platform shows fewer than 3, the CRM engagement score is automatically revised downward and the salesperson is notified.

**Note:** The analytics platform is the authoritative source for digital engagement data. CRM manual entries for digital engagement are treated as supplementary and weighted at 60% of the analytics-verified score.

---

### Rule V-09: Retroactive Entry Audit

**Problem:** Salespeople add interaction log entries after the fact (days or weeks later) to fabricate recent engagement and prevent leads from decaying.

**Rule:** All CRM entries are timestamped server-side at the moment of creation. The **entry creation timestamp** (immutable, server-generated) is stored separately from the **interaction date** (user-entered). If the entry creation timestamp is more than 48 hours after the stated interaction date, the entry is automatically flagged `RETROACTIVE_ENTRY`.

Retroactive entries are:
1. Counted at 50% of their score value
2. Flagged in the audit log
3. Presented to the branch manager in the weekly retroactive entry report

---

### Rule V-10: Manual Score Override Protocol

**Problem:** Users with CRM editing access can directly change the AI-computed score, effectively bypassing the entire scoring framework.

**Rule:** Manual score changes by any user role are:
1. Logged as a manual override in the immutable audit trail
2. Limited to ±10 points from the AI-computed score (changes beyond this require manager co-approval)
3. Automatically reverted after 7 days unless a supervisory approval note is attached
4. Reported in the weekly "Manual Override Summary" sent to the dealership principal

**Override Justification Field:** Required for all manual overrides. Minimum 20 words. The justification is stored alongside the override and reviewed during the weekly audit.

---

## CATEGORY 3 — SALESPERSON BIAS PREVENTION (Rules V-11 to V-14)

### Rule V-11: Blind AI Scoring for High-Value Leads

**Problem:** Salesperson notes for high-value leads are often written with optimism bias — describing the customer more favourably than the interaction data supports.

**Rule:** For leads with a budget indication above ₹20L, the AI scoring algorithm is run in two passes:
- **Pass 1 (Objective):** Scores only structured, system-generated data (call logs, website analytics, test drive logs, WhatsApp message metadata)
- **Pass 2 (Supplementary):** Incorporates salesperson notes, tagged separately as "salesperson assessment"

Pass 1 score and Pass 2 score are both displayed to the manager. If the difference exceeds 15 points, the manager is alerted.

---

### Rule V-12: Sentiment Score Isolation

**Problem:** A difficult or demanding customer is often penalised by salesperson notes in a way that depresses their score unfairly, even if their purchase intent is genuine.

**Rule:** The sentiment score dimension (5 points maximum) is computed only from NLP analysis of written customer communications (WhatsApp, email, call transcripts where available). Salesperson verbal assessments of customer tone are not permitted as primary inputs to the sentiment score.

Additionally, the sentiment score has zero influence on any other dimension score. A hostile customer with confirmed cash funds and an explicit booking declaration scores 0/5 on sentiment and 15/15 on financial readiness — the two dimensions are completely independent.

---

### Rule V-13: Salesperson Calibration Programme

**Problem:** Some salespeople chronically over-score leads; others chronically under-score. Both patterns reduce the reliability of the pipeline.

**Rule:** Monthly calibration reports are generated per salesperson showing:
- Average score given to leads that eventually converted (expected: 70–90)
- Average score given to leads that did not convert (expected: 25–50)
- If a salesperson's non-converting leads average above 60, they are flagged for over-scoring bias
- If a salesperson's converted leads average below 55, they are flagged for under-scoring bias

Calibration coaching is triggered when a salesperson falls outside acceptable ranges for 2 consecutive months.

---

### Rule V-14: Anonymous Peer Review Queue

**Problem:** There is no independent check on individual salesperson scoring decisions, making systematic bias invisible until conversion data reveals it — months too late.

**Rule:** 5% of all scored leads are randomly selected each week for anonymous peer review. The reviewing salesperson sees the interaction log and data but not the assigning salesperson's identity or original score. They produce an independent score. Discrepancies of more than 15 points are logged and reviewed by the branch manager.

Findings are aggregated quarterly to identify systematic scoring gaps at the team level.

---

## CATEGORY 4 — MISSING INFORMATION HANDLING (Rules V-15 to V-17)

### Rule V-15: Minimum Data Threshold for Scoring

**Problem:** Leads with almost no data receive arbitrary scores that are meaningless and potentially misleading.

**Rule:** A lead cannot be scored until all four minimum data elements are present:

| Element | Status Required |
|---------|----------------|
| Customer name | Verified (not "Test" or clearly fake) |
| Phone number | Validated (format check + carrier lookup) |
| At least one interaction logged | System-generated or salesperson-entered |
| Product interest | At least one model or segment mentioned |

Leads not meeting this threshold are placed in an `UNSCORED_INCOMPLETE` queue and assigned to a data collection workflow — a structured outreach to collect the missing information before scoring begins.

---

### Rule V-16: Missing Data Flags in JSON Output

**Problem:** Scores that appear complete but are based on thin data create false confidence.

**Rule:** The `missing_data_flags` array in every JSON output must be populated whenever a scoring dimension has been computed with absent or insufficient data. Examples of flags:

- `FINANCIAL_DATA_MISSING` — No budget, income, or loan data recorded
- `HOUSEHOLD_DECISION_MAKER_UNKNOWN` — No family or co-decision maker data
- `COMPETITOR_EVALUATION_UNKNOWN` — No competitor comparison data available
- `PRODUCT_PREFERENCE_UNCLEAR` — No specific variant or model preference recorded
- `TIMELINE_NOT_STATED` — No purchase timeline mentioned in any interaction

The presence of 3+ missing data flags is used as a trigger to reduce the lead score ceiling and increase the data-collection priority in the recommended action.

---

### Rule V-17: Data Completeness Incentive on Salesperson Dashboard

**Problem:** Without visible incentive, salespeople deprioritise CRM data entry quality.

**Rule:** Each lead displays a **Data Quality Score** (0–100%) on the salesperson's dashboard alongside the AI lead score. The formula is:

```
Data Quality = (fields_populated / total_scoreable_fields) * 100
```

Where scoreable fields include: phone (verified), email, income/budget, loan status, vehicle preference, test drive status, family involvement, competitor comparison, purchase timeline.

**Dashboard rule:** Leads with Data Quality below 40% are displayed with a visual alert and cannot be escalated to manager review until data completeness reaches 60%.

---

## CATEGORY 5 — DUPLICATE LEAD CONTROLS (Rules V-18 to V-21)

### Rule V-18: Real-Time Duplicate Alert at Lead Creation

**Problem:** A customer who visits on Saturday and submits an online enquiry on Sunday may be logged as two separate leads by two different salespeople.

**Rule:** The moment a new lead is being created, the system performs a real-time background check against all existing records. If match probability exceeds 85% on any combination of:
- Phone number
- Email address
- Name + vehicle interest + location

...the creating user is presented with the potential match before saving. They must either confirm it is a different person (with a documented reason) or merge with the existing record.

---

### Rule V-19: Cross-Channel Deduplication

**Problem:** The same customer may have entry points across website form, WhatsApp click, walk-in log, and inbound call — each creating a separate CRM record.

**Rule:** All lead intake channels are connected to the same deduplication engine using phone number as the universal primary key. When a new lead is created from any channel:

1. Phone number is looked up against the master customer database
2. If match found → new interaction is appended to existing record, not a new lead created
3. If no match → new lead record created with channel-of-origin tagged

This single-customer-record principle is the foundation of accurate score computation — without it, engagement history is fragmented and scores are artificially deflated.

---

### Rule V-20: Duplicate Resolution Protocol

When two records are confirmed as duplicates after creation:

1. Interaction histories are merged chronologically
2. The higher total score is retained as the starting base
3. All subsequent scoring is recomputed from the merged history
4. A `RECORD_MERGED` flag is placed in the audit log noting: original lead IDs, merge date, merging user, and reason
5. Both original salesperson IDs are retained for pipeline attribution and commission tracking

---

### Rule V-21: Monthly Deduplication Audit

A monthly system-wide deduplication audit scans the entire customer database for:
- Records sharing the same phone number with different names (possible typo or name variation)
- Records sharing the same email with different phone numbers (phone change)
- Records sharing the same name + city + vehicle interest from within a 90-day window (possible missed real-time deduplication)

Audit results are reviewed by the CRM administrator and presented to the dealership principal in the monthly operations report.

---

## CATEGORY 6 — ENTERPRISE AUDIT AND COMPLIANCE (Rules V-22 to V-25)

### Rule V-22: Immutable Score History

**Problem:** CRM records can be edited to make a salesperson's pipeline appear healthier than it was — especially at month-end or quarter-end when pipeline reviews occur.

**Rule:** Every score computation produces an immutable audit record containing:

| Field | Content |
|-------|---------|
| `audit_id` | Unique ID for this specific score computation |
| `lead_id` | Linked lead record |
| `timestamp` | Server-generated, non-editable |
| `algorithm_version` | Exact version of scoring algorithm used |
| `input_snapshot` | Full copy of all data used to compute this score |
| `score_breakdown` | Full dimension-by-dimension breakdown |
| `total_score` | Final score at time of computation |
| `manual_overrides_applied` | Any manual changes made post-computation |
| `validation_flags_raised` | All flags triggered during this computation |

This log is append-only. No edit or delete operations are permitted on audit records by any user role. The log is replicated to a separate storage system not accessible from the CRM front-end.

---

### Rule V-23: Algorithm Version Tracking

**Problem:** Scoring model updates change how leads are scored, but historical scores were computed under a different model. Comparing scores across algorithm versions without flagging produces misleading trend data.

**Rule:** Every score in the database is tagged with the algorithm version that produced it. When the model is updated:

1. A new algorithm version number is assigned
2. All existing scores are tagged `PRIOR_VERSION`
3. A background recomputation job runs over the next 48 hours to recompute all active lead scores under the new algorithm
4. Score changes from the recomputation are logged and reviewed
5. Any lead that changes category (e.g., HOT → WARM) due to the algorithm update is flagged for salesperson notification

---

### Rule V-24: Data Privacy and Regulatory Compliance

**Problem:** Customer financial data, contact information, and behavioural data are sensitive personal data subject to DPDP Act (India), GDPR (if applicable), and sectoral regulations.

**Rule:** The following data privacy controls are mandatory:

- All customer PII (name, phone, email, address, income) is encrypted at rest and in transit
- The AI scoring model operates on anonymised or pseudonymised data in the training pipeline; production inference uses identified data but never exports PII to third-party systems without explicit consent logging
- Customer consent for data collection is logged at first interaction; consent scope is recorded (product communication only vs. marketing vs. analytics)
- Customers who request data deletion must have their record anonymised within 30 days; their interaction history is retained in anonymised form for ML training under legitimate interest provisions
- The `recommended_action` field in AI outputs never contains the customer's personal financial details; it references dimensions generically ("financial readiness issue") to protect data in the event the output is forwarded or shared

---

### Rule V-25: Monthly Model Performance Review

**Problem:** A scoring model that is not measured against outcomes drifts into irrelevance. If HOT+ leads are not converting at 80%+ rates, the model is miscalibrated.

**Rule:** A monthly performance report is generated automatically containing:

| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| HOT+ conversion rate | ≥ 80% | < 65% |
| HOT conversion rate | ≥ 55% | < 40% |
| WARM conversion rate | ≥ 20% | < 10% |
| COLD conversion rate | ≤ 10% | > 20% (over-scoring cold leads) |
| Dead lead conversion rate | ≤ 2% | > 5% (under-scoring dead leads) |
| False positive rate (HOT+ no-conversion) | ≤ 20% | > 35% |
| False negative rate (COLD/DEAD that converted) | ≤ 5% | > 10% |
| Average score of converted leads | 70–90 | Outside this range = recalibration needed |
| Average score of non-converted leads | 20–50 | Outside this range = recalibration needed |

The report is reviewed by the dealership principal, CRM administrator, and AI system owner. Any metric breaching an alert threshold triggers a mandatory calibration review within 14 days. Persistent model drift (2 months above alert threshold) triggers an algorithm retraining cycle.

---

## Validation Framework Implementation Checklist

For dealership IT and CRM administrator use during deployment:

**Phase 1 — Pre-Launch:**
- [ ] V-09: Server-side timestamp system configured and tested
- [ ] V-01: Evidence count check logic deployed
- [ ] V-03: Financial data gate implemented
- [ ] V-15: Minimum data threshold enforced at lead creation
- [ ] V-19: Cross-channel deduplication engine connected to all intake sources
- [ ] V-22: Immutable audit log storage configured with separate replication

**Phase 2 — First Week:**
- [ ] V-07: Daily duplicate detection job scheduled
- [ ] V-08: Analytics platform integration for digital engagement validation
- [ ] V-10: Manual override protocol configured with manager approval workflow
- [ ] V-05: Recency decay function deployed server-side (no client override possible)

**Phase 3 — Monthly Cadence:**
- [ ] V-13: Salesperson calibration report scheduled
- [ ] V-14: Anonymous peer review queue configured (5% random selection)
- [ ] V-21: Deduplication audit job scheduled
- [ ] V-25: Model performance report scheduled with alert email to dealership principal

**Phase 4 — Quarterly:**
- [ ] V-23: Algorithm version review and potential retraining assessment
- [ ] V-24: Privacy compliance audit
- [ ] V-11: High-value lead blind scoring effectiveness review
