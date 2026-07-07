# Negative Buying Signals Reference
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## Overview

Negative signals are as diagnostically important as positive ones. An AI that can only detect enthusiasm will systematically over-score leads and destroy salesperson trust in the system. The negative signal library enables the AI to deprioritise unqualified prospects, detect manipulation, and protect salesperson time.

**Severity Scale:**
- **LOW:** Minor concern; does not significantly alter follow-up strategy
- **MEDIUM:** Significant concern; reduces score and shifts to lower-intensity follow-up
- **HIGH:** Major risk; lead is approaching COLD status
- **CRITICAL:** Near-disqualifying; likely DEAD or requires immediate escalation

---

## GROUP A — Competitor Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 1 | Mentioned evaluating a competitor model | LOW | -3 | Normal comparative shopping; manageable with value communication |
| 2 | Has received a competitor quotation | MEDIUM | -5 | Price comparison initiated; competitive vulnerability activated |
| 3 | Test drove a competitor car this week | MEDIUM | -6 | Physical competitor experience = entering final comparative stage |
| 4 | Said "the Creta is better value" | HIGH | -8 | Direct competitor preference statement; defection risk elevated |
| 5 | Competitor offered significantly better discount | HIGH | -7 | Financial incentive gap must be closed or the deal is lost |
| 6 | Competitor promised earlier delivery | MEDIUM | -5 | Delivery timeline advantage to competitor = urgency lever for them |
| 7 | Already booked competitor but "still looking" | CRITICAL | -15 | Booking means funds are committed; chance of reversal is very low |
| 8 | Competitor currently offering cashback scheme | MEDIUM | -4 | Scheme advantage must be matched or explained |
| 9 | Spouse prefers competitor brand | HIGH | -8 | Decision influencer aligned with competitor is critical risk |
| 10 | Previous vehicle was competitor brand and they were satisfied | MEDIUM | -5 | Brand loyalty to competitor is an emotional barrier with proven depth |
| 11 | Customer's neighbours or friends all own competitor brand | MEDIUM | -4 | Social environment creates peer pressure toward competitor |
| 12 | Customer has done extensive online research favouring competitor | MEDIUM | -5 | Research investment means they will defend their conclusion |
| 13 | Customer cited competitor's 5-star NCAP rating specifically | HIGH | -6 | Safety objection requires data-driven counter; emotional dismissal fails |
| 14 | Mentioned competitor's longer warranty as a specific advantage | MEDIUM | -4 | Feature gap; counter with total ownership cost |
| 15 | Competitor offered free insurance + accessories bundle | MEDIUM | -5 | Bundled value offer is difficult to counter without matching |

---

## GROUP B — Engagement Failure Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 16 | No response to 3 consecutive calls | HIGH | -8 | Three no-responses = disengagement pattern established |
| 17 | No response to 5+ WhatsApp messages over 7 days | HIGH | -10 | Week-long silence across multiple messages = lead going cold |
| 18 | Missed scheduled showroom appointment | MEDIUM | -5 | No-show without notice = low commitment level |
| 19 | Missed appointment twice | HIGH | -10 | Repeat no-show = pattern of non-commitment confirmed |
| 20 | Opens WhatsApp messages consistently but never replies | MEDIUM | -4 | Passive surveillance — saw your message, chose not to engage |
| 21 | Asked to stop receiving calls | CRITICAL | -20 | Explicit rejection of contact; must archive immediately |
| 22 | Blocked dealership number | CRITICAL | -25 | Hard block = definitive disengagement; lead is dead |
| 23 | Response time steadily increasing across interactions | MEDIUM | -5 | Increasing latency is a disengagement trend signal |
| 24 | Never replied to any digital communication | HIGH | -7 | Zero digital engagement = wrong channel or no genuine interest |
| 25 | Only responds to offers; ignores all other content | MEDIUM | -4 | Offer-only engagement = price-seeker, not relationship investment |
| 26 | Came for appointment but left within 5 minutes | HIGH | -8 | Extremely brief visit after commitment = strong disengagement |
| 27 | Did not engage with test drive opportunity when offered | HIGH | -7 | Declining a free test drive is a significant low-intent signal |
| 28 | Conversation quality declining — shorter replies each time | MEDIUM | -4 | Communication compression is a measurable disengagement signal |

---

## GROUP C — Financial Red Flags

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 29 | Budget stated is far below minimum variant price | HIGH | -10 | Fundamental financial misalignment; product repositioning required |
| 30 | Loan application rejected by bank | HIGH | -12 | Bank rejection removes the primary funding mechanism |
| 31 | Loan rejected by multiple banks | CRITICAL | -18 | Multiple rejections = structural financial disqualification |
| 32 | Says "waiting for bonus" without confirmed date | MEDIUM | -5 | Unconfirmed income event = vague financial dependency |
| 33 | Waiting for property sale to fund purchase | MEDIUM | -6 | Third-party financial dependency = unpredictable timeline |
| 34 | Budget inconsistency across interactions | MEDIUM | -5 | Stating different budgets to different salespeople = possible deception |
| 35 | Refuses to discuss financing at all (ambiguous reason) | LOW | -3 | May have cash (positive) or avoidance (negative); clarify before scoring |
| 36 | Asked for unrealistic discount that is commercially non-viable | MEDIUM | -4 | Extreme discount demand = possible price-shopper, not genuine buyer |
| 37 | Income appears too low to qualify for any available loan | HIGH | -8 | Income disqualification is a structural barrier |
| 38 | Mentioned financial crisis or family emergency recently | HIGH | -10 | Competing financial priorities significantly reduce purchase probability |
| 39 | Credit score known to be below 650 (if disclosed) | HIGH | -9 | Low CIBIL score = loan rejection risk; NBFC route needed |
| 40 | Dependent on a third party's financial decision (e.g. parent abroad) | HIGH | -8 | Untraceable decision dependency = high timeline uncertainty |

---

## GROUP D — Intent and Seriousness Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 41 | Said "just looking, no plans to buy soon" | MEDIUM | -5 | Self-declared low intent; however, validate against behaviour |
| 42 | Cannot confirm any purchase timeline | MEDIUM | -5 | No timeline = no urgency = low conversion probability |
| 43 | Timeline beyond 12 months | HIGH | -10 | 12+ month horizon means this is aspirational, not actionable now |
| 44 | Enquired "for a friend" | HIGH | -8 | Third-party enquiry = no personal commitment or urgency |
| 45 | Changes variant preference at every interaction | MEDIUM | -4 | Preference instability = still in early consideration, not selection |
| 46 | Asks the same questions repeatedly without progressing | MEDIUM | -5 | Repetitive questioning without advancement = stuck or not serious |
| 47 | Has been in pipeline for 90+ days with no progress | HIGH | -8 | 90-day stagnation with no progress = chronic browser confirmed |
| 48 | Visits showroom only during offer events | MEDIUM | -4 | Offer-triggered attendance = discount-seeker pattern |
| 49 | Comparing 5+ brands simultaneously | MEDIUM | -4 | Excessive brand comparison = very early stage; far from buying |
| 50 | Cannot articulate why they need a car | MEDIUM | -5 | Unclear use case = desire without need = lower conversion urgency |
| 51 | Asked detailed technical questions but shows no purchase warmth | MEDIUM | -4 | Information extraction pattern; may be a researcher or competitor |
| 52 | Responses are consistently non-committal on every point | MEDIUM | -5 | Blanket non-commitment = defensive engagement without intent |
| 53 | Has visited but asked to be taken off follow-up list | CRITICAL | -18 | Explicit opt-out; respect immediately and archive |

---

## GROUP E — Data Quality and Contact Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 54 | Phone number does not exist or is invalid | CRITICAL | -25 | Cannot be contacted = lead is effectively dead |
| 55 | Phone number belongs to a business, not individual | HIGH | -15 | Wrong contact; error or deliberate obfuscation |
| 56 | Email address bounces on first send | HIGH | -8 | Invalid email = reduced contact options |
| 57 | Name appears to be fake (e.g. "Test Customer", "Mr. ABC") | HIGH | -12 | Fake identity = enquiry was not genuine |
| 58 | Address provided is geographically inconsistent | LOW | -2 | May be buying from another dealer in their area |
| 59 | Duplicate enquiry with different details submitted | MEDIUM | -5 | Inconsistent duplicates = data quality problem requiring resolution |
| 60 | Consistent WhatsApp activity visible but never replies to dealership | MEDIUM | -4 | Active elsewhere = deliberate selective avoidance |
| 61 | Phone goes directly to voicemail on every attempt | MEDIUM | -5 | Consistent voicemail = possible blocking or number abandonment |
| 62 | No physical address after 3 direct requests | MEDIUM | -4 | Withheld address = reluctance to commit identity |
| 63 | Salesperson notes say "could not verify identity" | HIGH | -10 | Identity verification failure = high risk; do not allocate resources |
| 64 | Walk-in customer refused to give name | HIGH | -8 | Anonymous visit = very low commitment level |

---

## GROUP F — Family and Social Dynamics

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 65 | Spouse is not aware of the car purchase plan | MEDIUM | -5 | Unilateral decision attempt = likely to be reversed when spouse finds out |
| 66 | Spouse has visited and expressed clear disapproval | HIGH | -10 | Active spouse objection = most reliable deal-killer in Indian market |
| 67 | Parent disapproves of the model or budget | HIGH | -8 | Parental disapproval in multi-generational households = reversal risk |
| 68 | Visible family disagreement about brand during showroom visit | HIGH | -9 | In-person family conflict = deal at serious risk |
| 69 | Customer says "I need to ask my family" repeatedly (3+ times) | MEDIUM | -5 | Chronic deferral = decision-maker is absent; need to involve them |
| 70 | The actual decision-maker (son/daughter) is never present | MEDIUM | -5 | Scoring the wrong person; find the real decision-maker |
| 71 | Customer said "my wife will never agree" (volunteered) | HIGH | -10 | Self-identified household veto = deal is at high risk |
| 72 | Customer's family is pushing for a competitor brand loudly | HIGH | -9 | External family pressure creates a household-level competitive threat |

---

## GROUP G — Behavioural Negative Patterns

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 73 | Has visited 5+ times over 3+ months with no progression | HIGH | -10 | Chronic visitor who never converts = browser profile confirmed |
| 74 | Only visits to "pass time" — explicitly stated | HIGH | -12 | Direct admission of non-purchase intent |
| 75 | Asks detailed questions but reveals no personal information | MEDIUM | -5 | Information extraction = competitive intel or journalist |
| 76 | Collects all brochures and quotations then goes permanently silent | MEDIUM | -6 | Material collection without follow-through = price comparison pattern |
| 77 | Previously cancelled a booking from this dealership | HIGH | -10 | Cancellation history = high risk of repeat cancellation |
| 78 | Known to visit multiple dealerships regularly without ever buying | HIGH | -10 | Cross-dealership chronic browser if noted in CRM |
| 79 | Price aggression without any genuine purchase intent | MEDIUM | -5 | Persistent extreme price demands = wasting salesperson time |
| 80 | Gets angry or irritated when follow-up calls are made | HIGH | -8 | Negative emotional response to engagement = fundamentally disengaged |
| 81 | Previously complained formally about the dealership | HIGH | -9 | Existing grievance = trust is damaged; needs formal resolution first |

---

## GROUP H — Situational Negative Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 82 | Recently lost job or was laid off | HIGH | -12 | Income disruption = financial capability suspended |
| 83 | Medical emergency in family mentioned | HIGH | -10 | Financial priorities realigned; car becomes secondary |
| 84 | Recently separated or divorced (relevant to joint purchase) | MEDIUM | -6 | Decision structure changed; reassess who the buyer now is |
| 85 | Business facing losses (self-employed customer) | HIGH | -10 | Cash flow constraint = near-zero purchase probability near-term |
| 86 | Planning to relocate abroad within 6 months | CRITICAL | -15 | Relocation abroad removes the purchase need entirely |
| 87 | Natural disaster or significant property damage mentioned | HIGH | -10 | Emergency financial redirect away from vehicle purchase |
| 88 | Recently purchased another major asset (house, land) | MEDIUM | -6 | Capital deployed elsewhere = reduced liquidity for car |
| 89 | Mentioned that a close family member is critically ill | HIGH | -8 | Emotional and financial bandwidth consumed elsewhere |
| 90 | Company they work for has announced layoffs | HIGH | -9 | Future income uncertainty = delayed major purchases |

---

## GROUP I — Competitive Research Behaviour

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 91 | Asks for quotation explicitly to show to another dealer | MEDIUM | -5 | Quotation-as-leverage = you are being used, not selected |
| 92 | Uses your price to negotiate with a competitor brand | MEDIUM | -6 | Cross-brand price war usage = you are leverage, not primary |
| 93 | Asked for a written offer "to show family" — pattern of never returning | MEDIUM | -5 | Established deferral pattern using third-party approval as exit |
| 94 | Took photos of your price list without purchasing | LOW | -3 | Possible competitor intelligence gathering |
| 95 | Asked unusually detailed internal questions (dealer margin, incentives) | MEDIUM | -5 | Insider-knowledge probing = competitor or consultant behaviour |

---

## GROUP J — Communication Quality Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 96 | Uses rude or abusive language with staff | HIGH | -10 | Hostile customers rarely complete purchases; relationship is damaged |
| 97 | Contradicts their own previous statements repeatedly | MEDIUM | -6 | Inconsistency = either low seriousness or deep confusion |
| 98 | Makes unreasonable demands consistently | MEDIUM | -5 | Pattern of unreasonable expectation = high post-booking complaint risk |
| 99 | Refuses to give any personal information on any channel | MEDIUM | -6 | Privacy refusal = not ready to commit identity to a transaction |
| 100 | Communication is primarily complaints about your brand | HIGH | -8 | Complaint-dominated communication = brand distrust present |

---

## GROUP K — Chronic Cold Indicators

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 101 | Lead has been dormant 60+ days with no re-engagement | HIGH | -10 | Dormancy without any trigger = natural decay of interest |
| 102 | Was marked HOT previously, did not close, no explanation given | MEDIUM | -7 | Prior hot lead that didn't convert = unresolved hidden barrier |
| 103 | Has said "I'll let you know" more than 4 times | MEDIUM | -6 | Chronic deferral pattern = systematic avoidance behaviour |
| 104 | Score has declined 20+ points over the past 30 days | HIGH | -8 | Declining trend is as important as absolute score |
| 105 | Reclassified from HOT to COLD within a single interaction | HIGH | -10 | Sudden drop signals a disqualifying event that must be investigated |

---

## GROUP L — CRM and Systemic Signals

| # | Signal | Severity | Score Deduction | Explanation |
|---|--------|----------|----------------|-------------|
| 106 | Salesperson has not updated lead in 7+ days | MEDIUM | -3 | Stale CRM = unknown current status; scoring reliability reduced |
| 107 | Lead has been reassigned 3+ times | MEDIUM | -5 | Relationship continuity lost; trust capital depreciates with each handover |
| 108 | No call recording exists for any interaction | LOW | -2 | Evidence gap; must rely on potentially biased manual notes |
| 109 | Customer requested escalation to manager — request was ignored | HIGH | -8 | Unresolved escalation = trust damage |
| 110 | Dealership cancelled or rescheduled the test drive | MEDIUM | -5 | Dealership failure = trust damage; customer may go elsewhere |
| 111 | Customer received wrong pricing information and it was not corrected | HIGH | -8 | Misinformation without correction = trust destruction |
| 112 | Customer filed a complaint with the brand directly | CRITICAL | -15 | Brand-level complaint = relationship at its lowest possible point |
| 113 | Customer posted a negative review online about the dealership | CRITICAL | -15 | Public negative experience = trust broken; recovery is difficult |
| 114 | Customer said "I'll never buy from your dealership" | CRITICAL | -25 | Direct exclusion statement = lead is dead for this dealership |
| 115 | Previous booking cancelled from this dealership | HIGH | -12 | Prior cancellation is the most predictive signal of future cancellation |

---

## Signal Severity Summary by Group

| Group | Focus Area | Typical Severity | Max Deduction |
|-------|-----------|-----------------|---------------|
| A | Competitor Signals | LOW–HIGH | -15 |
| B | Engagement Failure | MEDIUM–CRITICAL | -25 |
| C | Financial Red Flags | MEDIUM–CRITICAL | -18 |
| D | Intent & Seriousness | MEDIUM–HIGH | -10 |
| E | Data Quality | MEDIUM–CRITICAL | -25 |
| F | Family Dynamics | MEDIUM–HIGH | -10 |
| G | Behavioural Patterns | MEDIUM–HIGH | -12 |
| H | Situational | MEDIUM–CRITICAL | -15 |
| I | Competitive Research | LOW–MEDIUM | -6 |
| J | Communication Quality | MEDIUM–HIGH | -10 |
| K | Chronic Cold | MEDIUM–HIGH | -10 |
| L | CRM/Systemic | LOW–CRITICAL | -25 |

---

## Negative Signal Stacking Rules

When multiple negative signals are present simultaneously, the AI must apply the following stacking logic:

**Rule NS-1: Cap Total Deduction**
No single dimension may have more points deducted than its maximum allocation. Financial readiness maximum is 15 points; it cannot go below 0.

**Rule NS-2: Critical Signal Override**
If any CRITICAL signal is detected (blocked number, fake contact, competitor booking confirmed, explicit opt-out), the lead must be immediately re-evaluated for DEAD classification regardless of positive signals in other dimensions.

**Rule NS-3: Three Medium = High Treatment**
If three or more MEDIUM signals are detected in the same scoring cycle, the AI should apply HIGH-level follow-up frequency reduction even if no individual signal is HIGH severity.

**Rule NS-4: Escalation Trigger**
If a customer record accumulates 5+ negative signals in a single 7-day window, the AI must trigger a manager review alert — this pattern indicates either a genuine crisis in the relationship or a lead that is being incorrectly retained in the active pipeline.

**Rule NS-5: Positive-Negative Conflict Resolution**
When a strong positive signal (e.g., customer brought cheque to showroom) conflicts with a strong negative signal (e.g., spouse strongly disapproved during same visit), the AI must surface both signals explicitly in the score output and flag for salesperson review rather than attempting to arithmetically resolve the conflict automatically.
