# Budget Analysis Framework
## AI-Powered Automotive Lead Intelligence Platform
### Version 1.0 — Production Grade

---

## Overview

Financial readiness is a 15-point dimension and among the most critical determinants of conversion probability. The AI must assess not just whether a customer can pay, but **when** they can pay and with **what degree of certainty**. Budget analysis requires both declared signals and inferred signals, and must handle the wide variety of financial profiles found in the Indian automotive market.

---

## Budget Score Reference Table

| Budget Scenario | Score Range | AI Disposition |
|----------------|-------------|----------------|
| Own funds confirmed, price-aligned | 13–15 | Immediate close priority |
| Loan pre-approved by bank | 13 | Confirm stock; close within 48 hours |
| Stable salaried employee, EMI viable | 10–11 | Process loan; 1-week close target |
| Self-employed, variable income | 6–8 | Pre-screen with NBFC; set expectations |
| First-time borrower, no credit history | 7–9 | NBFC route; manage processing time |
| Budget mismatch (gap <10%) | 7 | Adjust accessories; small top-up loan |
| Budget mismatch (gap 10–25%) | 5 | Downgrade variant; explore top-up |
| Budget mismatch (gap >25%) | 3 | Reposition to lower segment |
| Waiting for bonus (confirmed date) | 8–9 | Nurture; trigger 30 days before bonus |
| Waiting for salary increment | 5–7 | Nurture; trigger at increment quarter |
| Loan rejected (one bank) | 4 | Explore NBFCs; co-applicant option |
| Loan rejected (all banks) | 2 | Archive; no active investment |

---

## 7.1 Ready to Buy — Own Funds

**Definition:** Customer has liquid funds — savings, fixed deposit maturity, investment proceeds, or property sale — available to fund the purchase without any external dependency or approval requirement.

**Score Range:** 13–15 / 15

**Why This Is Maximum:** Own-funds buyers remove every financial uncertainty in the transaction. There is no loan approval waiting period, no EMI affordability calculation, no bank risk assessment. The only question is product selection and commercial terms.

**Indicators:**
- Mentions savings account, FD, or investment return
- Asks for exact on-road price to confirm against available cash
- Has brought cheque, demand draft, or RTGS details
- Does not mention EMI or loan despite asking for final price
- Phrases like "I'll pay full amount" or "no loan needed"

**EMI Affordability Check (Not Applicable):** For own-funds buyers, the EMI calculator is not relevant. However, it is worth noting the total on-road price relative to their stated available funds to flag any shortfall.

**AI Scoring Logic:**
- Available funds ≥ on-road price: Score 15/15
- Available funds = 90–99% of on-road price (small gap): Score 13/15 — flag gap, suggest accessories reduction
- Available funds = 75–89% of on-road price: Score 10/15 — gap requires a small top-up instrument

**Example Profile 1:**
> **Ramesh, 52, Retired Government Engineer, Coimbatore.** FD of ₹18 lakh matures this month. Looking at a compact SUV in the ₹14–16 lakh range. Visited showroom with son. Asked for complete on-road price. Said "we have the amount ready, just confirm the delivery timeline."
>
> **Budget Score: 15/15** — No financial dependency. Confirmed funds. Price within range. Only item pending is delivery date.
>
> **AI Action:** Prioritise immediately. Prepare on-road quotation and delivery confirmation. Call within 2 hours.

**Example Profile 2:**
> **Sujata, 44, Textile Business Owner, Surat.** Annual profit allows her to write a cheque for up to ₹22 lakh. No EMI preferred due to personal philosophy. Currently comparing two variants (₹17L and ₹20L on-road).
>
> **Budget Score: 14/15** — Own funds confirmed. Minor uncertainty on which variant she chooses (₹3L gap between options). Score is 14 not 15 because the exact variant has not been confirmed, introducing a ₹3L unknown.
>
> **AI Action:** Help her decide between variants. Do not introduce financial complexity. She does not need financing; she needs a product decision.

---

## 7.2 EMI Dependent

**Definition:** Customer intends to finance the vehicle through a monthly installment loan. Financial readiness depends on loan approval, EMI affordability, and employment stability.

---

### 7.2a Salaried Employee — Stable Employer

**Score: 10–11 / 15**

**Why:** Salaried employment with a recognised employer is the highest-confidence EMI profile. Banks will readily process the loan with standard documentation. Income is predictable and verifiable.

**Indicators:**
- Corporate salary slip available
- Employment with MNC, PSU, government, or established private firm
- No adverse credit history mentioned
- EMI within 25–35% of take-home income

**EMI Affordability Rule:**
| EMI / Take-Home Income | Zone | Score |
|------------------------|------|-------|
| Under 25% | Safe | +11 |
| 25–40% | Caution | +9 |
| 40–50% | Risk | +7 |
| Over 50% | Danger | +4 |

**Example:**
> **Karthik, 33, IT Project Manager, Bangalore. Take-home ₹95,000/month.** Looking at ₹16L car. Proposed EMI at 7-year tenure: ₹24,000/month (25.3% of income — safe zone). Has existing home loan EMI ₹22,000.
>
> **Combined EMI:** ₹46,000 / ₹95,000 = 48% of income. Caution zone.
>
> **Budget Score: 8/15** — Safe individually, but combined with home loan the burden is in caution-to-risk zone. AI should surface this to salesperson: "Combined EMI is 48% of income. Recommend 6-year tenure or lower variant to bring combined EMI below 40%."

---

### 7.2b Self-Employed with Variable Income

**Score: 6–8 / 15**

**Why:** Income variability creates genuine bank loan uncertainty. Most banks require 2–3 years of ITR for self-employed applicants. Some months may show losses or reduced income, which can affect loan-to-income ratio calculations.

**Indicators:**
- Customer mentions "business income" or "shop income"
- ITR available but income varies year to year
- Cannot produce standard payslip
- Monthly income stated as a range ("between ₹60,000 and ₹1.5 lakh")

**Scoring Nuances:**
- If ITR shows consistent income growth over 3 years: +8
- If ITR shows irregular or declining income: +5
- If no ITR at all: +4 (NBFC route only, higher interest)

**Example:**
> **Arumugam, 46, Garment Trader, Tirupur.** Monthly income varies ₹70,000–₹2 lakh depending on season. Annual ITR shows ₹14 lakh taxable income. Wants ₹18L car on 5-year EMI (approx ₹38,000/month).
>
> **Budget Score: 7/15** — ITR income supports the loan notionally. However, bank may calculate on lower end of income range, making EMI appear higher relative to income. NBFC with higher-income months as averaging basis may be the better route.

---

### 7.2c First-Time Borrower

**Score: 7–9 / 15**

**Why:** No prior loan history means no established CIBIL score. Most banks will lend to first-time borrowers but may require a higher down payment (20–25% instead of 10–15%) or a guarantor.

**Example:**
> **Preethi, 24, Software Engineer (first job 8 months ago). Salary ₹52,000.** Wants Nexon on EMI. Has no prior loans. Bank offered ₹9L at 25% down payment. She has ₹2.5L available for down payment on a ₹12L car.
>
> **Budget Score: 8/15** — Income supports EMI, but thin credit history requires higher down payment than she currently has available. ₹2.5L covers 21% of ₹12L — slightly below the 25% requirement. Can she add ₹600 more? If yes, proceed. If no, explore NBFC options.

---

## 7.3 Loan Pre-Approved

**Definition:** Customer has received formal loan approval from a bank or NBFC before visiting the dealership. They know their eligibility, interest rate, and maximum loan amount.

**Score: 13 / 15**

**Why This Score Is Near-Maximum:** Pre-approval eliminates the single largest source of post-intent conversion failure: loan rejection or delay. A pre-approved customer has done all the hard financial work before showing up. The transaction is financially de-risked.

**What Pre-Approval Confirms:**
- CIBIL score is acceptable (typically 700+)
- Income documentation has been reviewed
- Loan amount and tenure are confirmed
- Interest rate is locked in (or indicatively quoted)
- Processing time will be significantly shorter

**Example Profile A — Home Loan Customer:**
> **Deepa, 37, Bank Manager. HDFC pre-approved ₹15L car loan at 8.75% for 5 years.** Monthly EMI: ₹31,200. Take-home salary ₹1.1L. EMI/income ratio: 28%. Visited showroom with loan sanction letter. Looking at ₹17L car (₹2L own funds).
>
> **Budget Score: 13/15** — Pre-approval confirmed. Own gap of ₹2L already covered in her plan. This is a 24-hour close opportunity.

**Example Profile B — Pre-Approved via Car Brand NBFC:**
> **Manian, 40, Government Contractor. SBI pre-approved ₹12L at 9.2% for 7 years.** Monthly EMI: ₹21,400. Wants a ₹14L SUV (₹2L down payment to be paid from monthly savings over next 3 months).
>
> **Budget Score: 11/15** — Loan is pre-approved but ₹2L down payment is not immediately available (3-month accumulation plan). Slight timing risk. Score is 11 rather than 13 to reflect the 3-month fund accumulation dependency.

---

## 7.4 Loan Rejected

**Definition:** Customer's loan application was rejected by one or more banks.

**Score Range: 2–4 / 15**

**Scoring by Rejection Stage:**

| Rejection Stage | Score | Recovery Path |
|----------------|-------|---------------|
| Rejected by 1 bank; NBFC not yet tried | 4 | NBFC route viable |
| Rejected by 2 banks; NBFC pending | 3 | NBFC at higher interest; verify affordability |
| Rejected by all major banks + NBFCs | 2 | Functionally ineligible; archive |
| Rejected due to documentation issue (fixable) | 5 | Re-apply with corrected documents |

**Why Loan Rejection Can Be Recovered:**
- CIBIL issues can sometimes be explained (single late EMI, identity mix-up)
- NBFCs have more flexible underwriting criteria than traditional banks
- A co-applicant with better income/credit can revive the application
- Selecting a lower-priced vehicle reduces the required loan amount and may change eligibility

**Example:**
> **Vikram, 28, Delivery Executive. Salary ₹22,000/month.** Applied for ₹8L loan. Rejected by Axis Bank (income too low — minimum ₹25,000 required) and ICICI (prior microfinance default 2 years ago). Looking at ₹9L car.
>
> **Budget Score: 2/15** — Two rejections. Income below minimum for most banks. Prior default will appear on CIBIL for another 4 years. The most realistic path is a very small NBFC loan (₹5L maximum at 18–20% interest) against a lower-priced car (₹7L range). If customer's budget doesn't adjust, archive the lead.

---

## 7.5 Budget Mismatch

**Definition:** The customer's stated or inferred budget is materially lower than the on-road price of the vehicle they are interested in.

**Gap-Based Scoring:**

| Price Gap | Score | Recommended Action |
|-----------|-------|-------------------|
| < 10% (₹1–1.5L on a ₹15L car) | 7 | Reduce accessories; waive coating; adjust tenure |
| 10–25% (₹1.5–3.75L on a ₹15L car) | 5 | Downgrade 1 variant; explore top-up loan |
| 25–40% | 3 | Suggest a lower segment model |
| > 40% | 2 | Full product repositioning required |

**Example A — Small Gap:**
> **Kavya, 28, Software Engineer.** Budget ₹14L (own funds ₹3L + loan ₹11L). Desired variant on-road: ₹15.2L. Gap: ₹1.2L (8%).
>
> **Budget Score: 8/15** — Gap is less than 10%. Recommend removing optional accessories (₹30,000), reducing paint protection package (₹20,000), and extending loan tenure by 12 months to reduce EMI by ₹800 (frees up ₹9,600/year for a slightly higher loan). Gap is fully closable.

**Example B — Large Gap:**
> **Subramanian, 58, Retired.** Monthly pension ₹18,000. Wants a ₹17L SUV. EMI would be ₹36,000/month — more than twice his income. Gap: massive.
>
> **Budget Score: 2/15** — This is not a budget mismatch but a full financial disqualification for the desired product. Reposition to entry-level hatchback at ₹6–8L on a low EMI. Do not attempt to sell above his means.

---

## 7.6 Waiting for Bonus

**Definition:** Customer has an anticipated bonus payment intended for the down payment or full payment, but the amount has not yet been received.

**Score Range: 5–9 / 15**

**Reliability Tiers:**

| Bonus Type | Reliability | Score |
|-----------|-------------|-------|
| Annual bonus from listed company (HR confirmed) | Very high | 9 |
| Government employee annual bonus (DA/DA increment) | High | 8 |
| Private sector bonus (pattern history confirmed) | Moderate-high | 7 |
| Freelance/project bonus | Moderate | 6 |
| Commission-based bonus (sales professional) | Moderate | 6 |
| Business profit bonus (self-declared, no confirmation) | Low | 5 |

**AI Trigger Rule:** For any bonus-dependent customer with a score of 7+, the AI must automatically set a follow-up trigger at bonus date minus 21 days. This is when the customer begins physically having access to the funds.

**Example:**
> **Vijayalakshmi, 42, Senior Manager at PSU bank.** Annual performance bonus of ₹2.8L expected in April (historically consistent for 6 years). Wants to use it as down payment on a ₹15L car. Currently in January — 3-month wait.
>
> **Budget Score: 8/15** — PSU bank bonus is institutionally reliable. Pattern history of 6 years confirms payment. ₹2.8L covers 18.7% of ₹15L on-road (slightly below the typical 20% preferred, but compensated by her salary eligibility for the balance loan). Set trigger for March 10 (21 days before April 1).

---

## 7.7 Waiting for Salary Increment

**Definition:** Customer is waiting for a salary increase before feeling financially comfortable enough to commit to a car EMI.

**Score Range: 5–7 / 15**

**Two Distinct Sub-Scenarios:**

**Scenario A — Current Salary Would Support EMI, But Customer Is Psychologically Waiting**
Current income already makes the EMI viable (under 35% of income), but the customer wants the comfort of a higher salary before committing.
- Score: 7/15 — This is a confidence trigger, not a financial requirement. Approach: build confidence, show total cost of ownership data, gently challenge the wait with an opportunity cost argument (price increase risk, offer expiry).

**Scenario B — Current Salary Genuinely Does Not Support EMI; Increment Is Required**
The EMI-to-income ratio is above 45%, meaning the loan would be genuinely difficult to service at current income.
- Score: 5/15 — Genuine financial dependency. Timeline is the key variable. Treat as a time-shifted lead; set a reactivation trigger at the increment date.

**Example:**
> **Vivek, 29, Junior Developer. Current salary ₹42,000 take-home.** Wants ₹13L car; EMI would be ₹24,000 (57% of take-home — high risk zone). Increment in Q3 will bring salary to ₹58,000. At ₹58,000, EMI drops to 41% — still caution zone but manageable if no other major EMI exists.
>
> **Budget Score: 6/15** — Increment is needed to make this viable. Set Q3 reactivation trigger. Meanwhile, explore if a slightly lower-priced variant (₹11L, EMI ₹20,000) might work at current income (47% of ₹42,000 — still high, but closer to viable territory). Do not push to close now.

---

## Budget Analysis Interaction with Other Score Dimensions

**Budget and Urgency Interplay:**
A customer with urgent timeline signals but poor financial readiness presents a distinctive pattern. They want to buy now but cannot. The AI must:
1. Score urgency separately (reflecting genuine desire)
2. Score financial readiness separately (reflecting actual capability)
3. Flag the mismatch explicitly in the recommended action
4. Recommend resolving the financial issue as the first priority — urgency without funding does not produce a sale

**Budget and Engagement Interplay:**
High engagement + low financial readiness is the most common profile of "serious intent, unable to execute" leads. These customers deserve a dedicated nurture track that:
- Acknowledges their intent genuinely
- Helps them build toward financial readiness (loan guidance, NBFC options, down payment planning)
- Does not waste premium salesperson time on a daily basis
- Reactivates immediately when a financial event (bonus, increment, loan approval) occurs

**Budget Score Cliff:**
A confirmed loan rejection causes an immediate score cliff. The AI must recalculate the total score using the new financial readiness figure (2–4) and notify the salesperson of the category drop. A HOT customer with a loan rejection may drop to WARM or even COLD instantly — this is correct behaviour, not an error.
