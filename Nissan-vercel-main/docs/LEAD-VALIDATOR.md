# Lead Validator Agent — Amirtha

FastAPI + LangGraph agent that validates lead input and persists to DB.
Endpoint: `POST http://localhost:8001/validate-lead`

---

## Files

| File | Purpose |
|------|---------|
| `apps/api/main.py` | FastAPI app, `/validate-lead` endpoint |
| `apps/api/agents/lead_validator/state.py` | TypedDict state: `LeadInput`, `LeadValidatorState` |
| `apps/api/agents/lead_validator/nodes.py` | 4 node functions |
| `apps/api/agents/lead_validator/graph.py` | LangGraph StateGraph wiring |
| `apps/api/requirements.txt` | Python deps |
| `supabase/migrations/0014_leads_enquiry_count.sql` | Adds `enquiry_count` column |
| `supabase/migrations/0015_leads_form_fields.sql` | Adds form fields to leads + city to customers |

---

## Pipeline (4 nodes)

```
validate_phone → [HARD FAIL if invalid] → validate_email → validate_fields → dedup_and_persist
```

| Node | What it does | On fail |
|------|-------------|---------|
| `validate_phone` | Indian mobile regex `^(?:\+91)?[6-9]\d{9}$`. Strips `+91` prefix → stores 10-digit. | HARD FAIL — pipeline stops, nothing written to DB |
| `validate_email` | Basic email regex | warn only |
| `validate_fields` | source enum, budget_range enum, timeframe enum, call_time enum, channel enum | warn only |
| `dedup_and_persist` | Lookup customer by phone. Duplicate → increment `enquiry_count`. New → insert customer + lead. | — |

---

## Dedup logic

- Identity = **phone number only** (not phone + tenant_id)
- Phone is always normalised to 10 digits (strips `+91` / `91` prefix) before DB lookup and storage
- `+919876543210` and `9876543210` → same customer, same lead

---

## Input schema (`POST /validate-lead`)

```json
{
  "tenant_id": "abc-nissan",
  "source": "website",
  "full_name": "Meena Selvam",
  "phone": "+919876543210",
  "email": "meena@gmail.com",
  "vehicle_interest": "Magnite Top Variant",
  "city": "Chennai",
  "test_drive_requested": true,
  "budget_range": "12_18l",
  "purchase_timeframe": "1_3_months",
  "preferred_call_time": "today",
  "preferred_channel": "whatsapp"
}
```

### Valid enum values

| Field | Valid values |
|-------|-------------|
| `source` | `oem`, `website`, `facebook`, `instagram`, `walkin`, `phone`, `event`, `referral` |
| `budget_range` | `under_8l`, `8_12l`, `12_18l`, `18_25l`, `above_25l` |
| `purchase_timeframe` | `immediately`, `this_month`, `1_3_months`, `3_6_months`, `just_exploring` |
| `preferred_call_time` | `today`, `within_2_days`, `this_week`, `no_rush` |
| `preferred_channel` | `whatsapp`, `phone_call`, `email`, `sms` |

---

## Output schema

```json
{
  "status": "inserted | duplicate | invalid",
  "lead_id": "uuid or null",
  "customer_id": "uuid or null",
  "enquiry_count": 1,
  "normalized_phone": "9876543210",
  "source": "website",
  "warnings": [],
  "errors": [],
  "is_duplicate": false
}
```

---

## DB changes

**`customers` table** — new column:
- `city VARCHAR`

**`leads` table** — new columns:
- `enquiry_count INTEGER DEFAULT 1` — incremented on each duplicate submission
- `budget_range VARCHAR` — categorical (replaces numeric `budget` for form input)
- `test_drive_requested BOOLEAN`
- `purchase_timeframe VARCHAR`
- `preferred_call_time VARCHAR`
- `preferred_channel VARCHAR`

---

## Running

```powershell
# 1. Activate venv
cd d:\Nissan\adip\apps\api
.\.venv\Scripts\Activate.ps1

# 2. Install deps (first time only)
pip install -r requirements.txt

# 3. Start server
uvicorn main:app --port 8001 --reload
```

Requires `SUPABASE_URL` env var — set it to the hosted Supabase project's URL (from `apps/api/.env`). There is no local-stack default.

---

## Test curl examples

```powershell
# New lead
Invoke-RestMethod -Method Post -Uri http://localhost:8001/validate-lead `
  -ContentType "application/json" `
  -Body '{"tenant_id":"abc-nissan","source":"website","full_name":"Meena Selvam","phone":"+919876543210","email":"meena@gmail.com","vehicle_interest":"Magnite","city":"Chennai","test_drive_requested":true,"budget_range":"12_18l","purchase_timeframe":"1_3_months","preferred_call_time":"today","preferred_channel":"whatsapp"}'

# Duplicate (same phone)
# → status: duplicate, enquiry_count incremented

# Invalid phone
Invoke-RestMethod -Method Post -Uri http://localhost:8001/validate-lead `
  -ContentType "application/json" `
  -Body '{"tenant_id":"abc-nissan","source":"website","full_name":"Test","phone":"12345"}'
# → status: invalid, errors: [{field: phone, message: ...}]
```

---

## What this agent does NOT do

- Scoring — separate agent (Csriram)
- Pushing validated data to external sources — separate agent
- Pulling from source — separate agent
