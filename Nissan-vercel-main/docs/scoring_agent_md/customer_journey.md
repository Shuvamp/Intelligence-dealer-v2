# Customer Journey & Engagement Analysis
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## SECTION 8 — ENGAGEMENT ANALYSIS

### Overview

Engagement scoring measures the quality, depth, recency, and consistency of interaction between the customer and the dealership across all touchpoints. Engagement is not merely a frequency count — it is a quality-weighted assessment. One proactive inbound call from a customer is worth more than five outbound calls that went unanswered.

**Engagement Decay Rule:** All engagement scores must apply a recency decay function:
- Interaction within 7 days: Full score value
- Interaction 8–14 days ago: 75% of score value
- Interaction 15–30 days ago: 50% of score value
- Interaction 31–60 days ago: 25% of score value
- Interaction >60 days ago: 10% of score value

---

### 8.1 Telephone Calls

**Outbound Call (Dealership calls customer):**

| Outcome | Score | Reasoning |
|---------|-------|-----------|
| Customer answered; had a meaningful conversation (5+ min) | +5 | Sustained engagement; customer invested time in the call |
| Customer answered briefly; expressed interest | +3 | Light engagement; interest maintained but not deep |
| Customer answered; noncommittal response | +1 | Contact maintained but engagement is weak |
| Customer answered; asked not to be called again | -8 | Active disengagement signal; remove from calling queue |
| Call went to voicemail; callback received within 24 hours | +4 | Customer initiated callback = self-motivated engagement |
| Call went to voicemail; no callback | 0 | No engagement signal either way |
| Phone rang but not answered (3 consecutive attempts) | -3 | Avoidance pattern forming |
| Phone disconnected/invalid | -10 | Contact failure; data quality problem |

**Inbound Call (Customer calls dealership):**

| Outcome | Score | Reasoning |
|---------|-------|-----------|
| Customer called to ask a specific question | +8 | Proactive self-initiated engagement = strong intent signal |
| Customer called to confirm an appointment | +9 | Appointment confirmation = commitment behaviour |
| Customer called to ask about an offer or stock | +7 | Action-oriented enquiry = decision-stage activation |
| Customer called to complain | -3 | While inbound, complaint calls indicate friction in the experience |

**Reasoning:** Inbound calls carry 60% more weight than outbound calls because they are self-motivated. A customer who picks up their phone to call a dealership has crossed an activation threshold that outbound-contacted leads have not.

---

### 8.2 WhatsApp Interactions

WhatsApp is the primary communication channel in Indian automotive retail. Engagement quality on WhatsApp is a strong predictor of conversion intent.

| Interaction Type | Score | Reasoning |
|-----------------|-------|-----------|
| Customer replied within 1 hour | +5 | High engagement responsiveness |
| Customer replied within 24 hours | +3 | Active but not urgent |
| Customer replied after 2–7 days | +1 | Low engagement; interest maintained but cooling |
| Customer opened (blue tick) but did not reply | -2 | Passive avoidance; saw the message, chose not to respond |
| Customer asked a specific product question unprompted | +7 | Proactive question = active consideration phase |
| Customer sent a photo (car colour, comparison screenshot) | +6 | Visual engagement = decision-support behaviour |
| Customer shared your message with someone else | +5 | Social validation seeking; involving influencer |
| Customer sent audio note | +4 | Higher-effort communication form = stronger engagement |
| Customer asked to reschedule (not cancel) | +2 | Rescheduling shows intent maintained |
| Customer asked to stop receiving messages | -10 | Hard disengagement; remove from WhatsApp sequence immediately |
| Customer said "I'll let you know" to a direct booking push | -3 | Deferral; no immediate intent |
| Customer replied only to offers/discounts, not other messages | -3 | Selective engagement = price sensitivity, not relationship investment |

**WhatsApp Sequence Engagement Scoring:**
- Customer opened and replied to 3+ messages in a sequence: +8
- Customer opened all messages but replied to none: -4
- Customer replied to only the first message in a long sequence: -3
- Customer initiated a conversation after going silent for 14+ days: +6 (re-activation signal)

---

### 8.3 Showroom Walk-In Visits

Physical presence is the highest-cost engagement form for the customer and therefore carries the highest score weight.

| Visit Type | Score | Reasoning |
|-----------|-------|-----------|
| First walk-in (no prior digital engagement) | +5 | Unannounced entry; physical presence is a strong signal |
| First walk-in (after digital enquiry) | +6 | Digitally converted to physical = funnel progression |
| Second walk-in within 7 days | +8 | Rapid return = active evaluation phase |
| Second walk-in after 8–30 days | +6 | Sustained interest; return visit confirms continued evaluation |
| Third or more walk-in | +10 | Multiple visits = near-decision behaviour |
| Brought spouse/partner on visit | +7 | Decision-critical person involved = preparation for commitment |
| Brought parents | +6 | Family financial decision validation |
| Scheduled appointment and arrived on time | +8 | Commitment behaviour; kept their word |
| Arrived unannounced during busy hours | +5 | Urgency-driven visit |
| Attended evening demo or promotional event | +5 | Deliberate time investment in the dealership experience |
| Visited only when free service camp or scheme active | -2 | Scheme-triggered visit; may not be a genuine buyer |
| Missed appointment without notice | -5 | Commitment failure |
| Missed appointment twice | -10 | Pattern of non-commitment |

---

### 8.4 Website and Digital Engagement

Website engagement provides intent signals even before the first human interaction.

| Digital Behaviour | Score | Reasoning |
|------------------|-------|-----------|
| Visited website 1 time, viewed 1–2 pages | +1 | Minimal; could be accidental |
| Visited website 2–3 times, viewed 3–5 pages | +3 | Genuine research initiation |
| Visited website 4+ times | +5 | Sustained digital research = active consideration |
| Used EMI calculator | +5 | Financial planning behaviour = purchase intent |
| Visited specific variant page multiple times | +4 | Variant-level engagement = narrowing down |
| Downloaded brochure | +3 | Reference building = serious consideration |
| Clicked "Book a Test Drive" button | +7 | Action intent even if not completed |
| Completed online test drive booking | +9 | Completed digital action = committed engagement |
| Submitted enquiry form | +5 | Voluntary data submission = real interest |
| Opened product comparison tool | +4 | Active comparative evaluation |
| Visited "About Us" or "Service Centre" page | +2 | Post-purchase thinking; evaluating the dealership |
| Spent >5 minutes on a single variant page | +4 | Deep reading = serious evaluation |
| Visited within 24 hours of a salesperson's message | +5 | Message-triggered visit = responsive engagement |

---

### 8.5 Test Drives

Test drives are the single most reliable predictor of near-term purchase intent when combined with positive feedback.

| Test Drive Signal | Score | Reasoning |
|-----------------|-------|-----------|
| Completed first test drive | +8 | Physical experience of the product = significant intent investment |
| Completed test drive, gave positive verbal feedback | +10 | Positive feedback removes product uncertainty |
| Completed test drive, gave negative feedback | +2 | Negative feedback reduces intent but provides data for counter-positioning |
| Requested a second test drive of same model | +9 | Rare behaviour — strongly indicates near-purchase confirmation |
| Requested family member to drive during test | +7 | Involving decision-maker in experience |
| Asked to test drive specific variant (not base model) | +6 | Variant specificity = selection stage |
| Asked for a longer test drive route | +5 | Experience depth preference = serious evaluation |
| Requested highway drive experience | +5 | Ownership simulation behaviour |
| Test drive cancelled by dealership | -5 | Dealership failure = trust damage |
| No-showed for scheduled test drive | -6 | Commitment failure on a high-engagement activity |
| Completed test drive, immediately asked for quotation | +12 | Post-drive quotation request = textbook buying signal |

---

### 8.6 Event Attendance

| Event Type | Score | Reasoning |
|-----------|-------|-----------|
| Attended product launch event | +6 | Voluntary time investment in brand experience |
| Attended test drive camp / outdoor event | +7 | Physical brand engagement at higher involvement level |
| Attended finance and EMI awareness workshop | +8 | Finance-focused event attendance = purchase planning behaviour |
| Attended accessories showcase | +5 | Post-purchase planning behaviour |
| Attended at invitation only, came with family | +7 | High-commitment attendance with decision-maker present |
| Attended multiple events over time | +9 | Sustained event engagement = highest-quality nurture response |
| Attended competitor event (reported) | -4 | Active competitive evaluation in progress |

---

### Engagement Score Composite Formula

```
Engagement Score = SUM of raw engagement points × Recency Decay Factor
Max Score: 20 points

Recency Decay:
- 0–7 days: factor = 1.0
- 8–14 days: factor = 0.75
- 15–30 days: factor = 0.50
- 31–60 days: factor = 0.25
- >60 days: factor = 0.10
```

**Engagement Score Interpretation:**
| Score | Interpretation |
|-------|---------------|
| 17–20 | Highly engaged; convert within 48 hours |
| 12–16 | Actively engaged; priority follow-up |
| 8–11 | Moderately engaged; structured nurture |
| 4–7 | Low engagement; automated sequence |
| 0–3 | Disengaged; re-qualification needed |

---

## SECTION 9 — CUSTOMER JOURNEY ANALYSIS

### Overview

The automotive purchase journey follows a predictable six-stage funnel. The AI must identify which stage a customer is currently in, what the characteristic behaviours of that stage are, what score range aligns with the stage, and what the optimal follow-up strategy is. Misaligning follow-up strategy to journey stage is the most common cause of lead attrition.

---

### Stage 1: AWARENESS

**Definition:** The customer has become aware of the product or brand but has not begun serious evaluation. This is the entry point of the funnel.

**Typical Behaviours:**
- Saw an advertisement (digital, print, outdoor, TV)
- Browsed the brand website casually
- Heard about the product from a friend or family member
- Glanced at the car on the road and remembered the model name
- Attended a motor show or auto expo without specific intent

**Customer Language at This Stage:**
- "I've heard about this car — what is it like?"
- "I saw your ad on Instagram."
- "My colleague got one of these — I wanted to see what it looks like."
- "Do you have any brochures I can take?"

**Intent Level:** Very low — curiosity without evaluation

**Score Range:** 5–20

**AI Recommendation:**
- Do NOT attempt to sell at this stage.
- Deliver value: brochure, video link, comparison tool.
- One follow-up touchpoint within 48 hours of initial contact.
- Move to a 7-day nurture cadence after that.

**Follow-up Strategy:**
1. Same-day: Send welcome WhatsApp with product highlights
2. Day 3: Share a short product video or customer testimonial
3. Day 7: Invite to a test drive with no pressure messaging
4. Day 14: Send a limited-time offer if available

---

### Stage 2: CONSIDERATION

**Definition:** The customer has identified that they want to buy a car and is actively comparing options. Your brand/model is one of several being considered.

**Typical Behaviours:**
- Multiple brand website visits
- Asking for quotations from different dealers
- Reading reviews on CarDekho, AutoCarIndia, Team-BHP
- Asking questions about mileage, safety, features across brands
- Discussing with family or peer group
- May have attended 2–3 dealerships

**Customer Language:**
- "I'm looking at the Creta, the Seltos, and your model."
- "What makes your car better than the Nexon?"
- "My husband and I are comparing a few options."
- "What's the mileage in real city conditions?"

**Intent Level:** Moderate — narrowing down but brand decision pending

**Score Range:** 25–45

**AI Recommendation:**
- Differentiate clearly from named competitors.
- Provide concrete comparison data, not vague claims.
- Offer a test drive to move to Stage 3.
- Share TCO (total cost of ownership) calculator.
- Engage every 4–5 days.

**Follow-up Strategy:**
1. Provide a 3-model comparison sheet (your model + their two named competitors)
2. Share real owner testimonials or reviews
3. Offer a test drive appointment within 3 days
4. Send EMI comparison for the budget they mentioned

---

### Stage 3: EVALUATION

**Definition:** The customer has narrowed their choice to 2–3 models (often your model is one of them) and is conducting deeper, criteria-specific evaluation. Feature, variant, and colour decisions are being made.

**Typical Behaviours:**
- Multiple visits to your showroom
- Detailed questions about specific features (sunroof, ADAS, boot space)
- Asking about variant differences (mid vs. top)
- Requesting a detailed quotation
- Comparing EMI structures
- Beginning to think about insurance, accessories, registration

**Customer Language:**
- "What's the difference between the mid and top variant?"
- "Does the mid have the sunroof?"
- "Is this colour available in the top variant?"
- "Can you send me a detailed break-up of the on-road price?"

**Intent Level:** High — product and variant being finalised

**Score Range:** 45–65

**AI Recommendation:**
- Narrow the conversation to specific decisions (variant, colour, finance).
- Remove decision barriers one by one.
- Introduce the finance team if EMI is under evaluation.
- Begin creating mild urgency around stock availability.
- Follow up every 2–3 days.

**Follow-up Strategy:**
1. Send a personalised quotation for the exact variant and colour they mentioned
2. Call within 24 hours of sending quotation to answer questions
3. Offer a comparison between the two variants they are evaluating
4. Create a soft urgency message about stock for their preferred colour

---

### Stage 4: TEST DRIVE

**Definition:** The customer has agreed to and completed a test drive. This is the physical product experience that often serves as the tipping point between evaluation and decision.

**Typical Behaviours:**
- Scheduled and attended a test drive
- Brought a family member to the test drive
- Asked questions during the drive (boot space, entertainment system, ride quality)
- Gave positive verbal feedback post-drive
- May ask for a second drive or to extend the route

**Customer Language:**
- "The ride was smoother than I expected."
- "My wife liked the interior."
- "The boot space is better than the Creta we drove."
- "Can I take it on the highway next time?"

**Intent Level:** Very high — product experience completed positively

**Score Range:** 60–80

**AI Recommendation:**
- Strike while the emotional connection is fresh.
- Call within 2 hours of test drive completion.
- Address any concern raised during the drive immediately.
- Transition directly to quotation and stock confirmation.
- Urgency: "The colour you liked has 2 units remaining."

**Follow-up Strategy:**
1. 2 hours after test drive: Call for feedback; ask "what did you like most?"
2. Same evening: Send WhatsApp with the exact quotation for the variant they drove
3. Next morning: Follow up asking "did you get a chance to discuss with family?"
4. Day 2: Introduce finance manager if EMI is involved
5. Day 3: Create urgency with stock or offer timing

---

### Stage 5: NEGOTIATION

**Definition:** The customer has decided to purchase from your dealership and is now negotiating the final price, discount, accessories, finance terms, or exchange value.

**Typical Behaviours:**
- Asking for the "best price"
- Comparing your discount with another dealer's offer
- Asking about free accessories, extended warranty, or free insurance
- Requesting to speak with the sales manager
- Asking for specific EMI structures (longer tenure, lower EMI)
- Asking about exchange valuation

**Customer Language:**
- "What's the maximum discount you can give?"
- "The other dealer is offering ₹30,000 more discount."
- "Can you throw in a dash cam and floor mats?"
- "If you can match this number, I'll book today."
- "Can I get the Diwali offer even though it ends tomorrow?"

**Intent Level:** Extremely high — the decision to purchase has been made; only commercial terms are being finalised

**Score Range:** 75–90

**AI Recommendation:**
- Involve sales manager at this stage — do not let negotiation stall.
- Respond to every counter-offer within 2 hours maximum.
- Have finance manager on standby for EMI finalisation.
- Document all commitments made during negotiation.
- Do NOT introduce new confusion (variants, models, colours) at this stage.
- Follow up every 2–4 hours.

**Follow-up Strategy:**
1. Present a final revised quotation within 2 hours of any counter-offer
2. Call (do not WhatsApp) for any offer-expiry communications
3. Get verbal confirmation before preparing booking paperwork
4. Prepare all documents proactively to eliminate post-commitment delay

---

### Stage 6: PURCHASE

**Definition:** The customer has confirmed the purchase and is completing the booking, documentation, and payment process.

**Typical Behaviours:**
- Submitted booking amount (token or full payment)
- Provided KYC documents
- Signed booking form
- Selected number plate preference
- Asked about delivery date confirmation
- Asked about accessories installation before delivery

**AI Recommendation at This Stage:**
- Transition to a customer experience and delivery management role.
- Ensure every promised commitment is delivered.
- Begin the 30-day post-delivery follow-up sequence to convert to a repeat buyer and referral source.

**Score:** 90–100 (Purchase confirmed)

---

### Journey Stage Score Matrix

| Stage | Name | Score Range | Primary AI Action |
|-------|------|-------------|------------------|
| 1 | Awareness | 5–20 | Educate, no pressure |
| 2 | Consideration | 25–45 | Differentiate, offer test drive |
| 3 | Evaluation | 45–65 | Narrow, personalise, create mild urgency |
| 4 | Test Drive | 60–80 | Strike fast, quotation same day |
| 5 | Negotiation | 75–90 | Escalate, close with speed |
| 6 | Purchase | 90–100 | Deliver, convert to referral |
