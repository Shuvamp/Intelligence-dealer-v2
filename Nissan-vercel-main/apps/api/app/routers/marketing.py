from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import base64
import logging
import re
import uuid
import httpx

from app.config import CALENDARIFIC_API_KEY
from app.poster_prompt import build_poster_prompt

logger = logging.getLogger(__name__)

# Generated posters are stored in the backend (served by main.py at /posters).
POSTERS_DIR = Path(__file__).resolve().parent.parent.parent / "generated" / "posters"
# User-attached videos (Content Studio → YouTube) — served by main.py at /videos.
VIDEOS_DIR = Path(__file__).resolve().parent.parent.parent / "generated" / "videos"
_ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".webm", ".avi", ".mkv"}
_MAX_VIDEO_BYTES = 500 * 1024 * 1024  # 500MB — generous for a dealer-made promo clip
from app.gemini import gemini_image, has_gemini_key
from app.llm import llm_json, has_llm
from app.agents.content_generation import content_agent, generate_batch, suggest_field
from app.agents.campaign_planning import campaign_planning_agent
from app.agents.brand_compliance import compliance_agent
from app.agents.marketing_copilot import copilot_agent
from app.agents.publishing import publishing_agent

router = APIRouter()

BRAND_SYSTEM_PROMPT = (
    'You are the marketing agent for "Dealer Intelligence OS", a Nissan dealership marketing platform in India (Tamil Nadu). '
    'Brand voice: Nissan — confident, aspirational, friendly. Indian audience; ₹ for prices. '
    'Vehicles: Magnite (compact SUV), X-Trail (premium SUV), Kicks, Terrano, Sunny. '
    'Always return ONLY the requested JSON. No preamble, no markdown.'
)


# ── Request / Response models ────────────────────────────────────────────────

class ContentRequest(BaseModel):
    vehicle: str
    channel: str
    theme: str
    offer: Optional[str] = None
    objective: Optional[str] = None

class ContentResponse(BaseModel):
    headline: str
    subheadline: str
    caption: str
    hashtags: list[str]
    cta: str


class CampaignPlanRequest(BaseModel):
    campaign_name: str
    campaign_type: str
    vehicles: list[str] = []
    goal: str
    start_date: str
    end_date: str
    posting_time: Optional[str] = None
    notes: Optional[str] = None
    selected_assets: list[dict] = []

class CampaignDay(BaseModel):
    day_num: int
    date: str
    theme: str
    vehicle: Optional[str] = None
    asset_id: Optional[str] = None

class CampaignPlanResponse(BaseModel):
    days: list[CampaignDay]


class PublishRequest(BaseModel):
    post_id: str
    campaign_id: str
    channel: str
    scheduled_at: str = ""
    content: dict = {}

class PublishResponse(BaseModel):
    published: bool
    platform_post_id: Optional[str] = None
    channel: Optional[str] = None
    published_at: Optional[str] = None
    error: Optional[str] = None


class ComplianceRequest(BaseModel):
    caption: str
    hashtags: list[str]
    channel: str
    offer: Optional[str] = None

class ComplianceResponse(BaseModel):
    compliance: str  # "approved" | "flagged"
    flags: list[str]


class PosterRequest(BaseModel):
    vehicle: str
    channel: str
    offer: Optional[str] = None
    theme: Optional[str] = None

class PosterResponse(BaseModel):
    poster_prompt: str
    headline: str
    offer_badge: Optional[str] = None
    poster_image_url: Optional[str] = None


class CopilotRequest(BaseModel):
    question: str
    campaign_context: list[dict] = []
    snapshot_context: str = ""

class CopilotResponse(BaseModel):
    answer: str


class SuggestDescriptionRequest(BaseModel):
    campaign_name: str
    campaign_type: str
    occasion: str = ""

class SuggestDescriptionResponse(BaseModel):
    description: Optional[str] = None


class SuggestHashtagsRequest(BaseModel):
    campaign_name: str
    campaign_type: str
    region: str = "Tamil Nadu"
    occasion: str = ""

class SuggestHashtagsResponse(BaseModel):
    hashtags: list[str] = []


# ── Content Generation (Agent 3) ─────────────────────────────────────────────

@router.post("/content/generate", response_model=ContentResponse)
def generate_content(req: ContentRequest):
    result = content_agent.invoke({
        "vehicle": req.vehicle,
        "channel": req.channel,
        "offer": req.offer,
        "objective": req.objective,
        "theme": req.theme,
        "result": None,
    })
    data: dict = result.get("result") or {}
    return ContentResponse(
        headline=data.get("headline", f"Drive the Nissan {req.vehicle}"),
        subheadline=data.get("subheadline", f"Experience {req.theme} today"),
        caption=data.get("caption", ""),
        hashtags=data.get("hashtags", []),
        cta=data.get("cta", "Enquire Now"),
    )


# ── Batch Content Generation (campaign days + monthly events) ─────────────────

class BatchItem(BaseModel):
    idx: int
    date: str = ""
    theme: str = ""
    vehicle: Optional[str] = None
    offer: Optional[str] = None

class BatchContentRequest(BaseModel):
    campaign_name: str = "Nissan campaign"
    goal: str = ""
    vehicles: list[str] = []
    channels: list[str] = []
    items: list[BatchItem]

class BatchContentItem(BaseModel):
    headline: str = ""
    subheadline: str = ""
    caption: str = ""
    hashtags: list[str] = []
    cta: str = "Enquire Now"
    ai: bool = False

class BatchContentResponse(BaseModel):
    items: list[BatchContentItem]


@router.post("/content/batch", response_model=BatchContentResponse)
def content_batch(req: BatchContentRequest):
    results = generate_batch(
        {
            "campaign_name": req.campaign_name,
            "goal": req.goal,
            "vehicles": req.vehicles,
            "channels": req.channels,
        },
        [it.model_dump() for it in req.items],
    )
    return BatchContentResponse(items=[BatchContentItem(**r) for r in results])


class SuggestFieldRequest(BaseModel):
    field: str
    vehicle: str = "Nissan"
    theme: str = ""
    channel: str = "social media"
    campaign_name: str = ""
    current: str = ""

class SuggestFieldResponse(BaseModel):
    value: str | list[str] = ""


@router.post("/content/suggest-field", response_model=SuggestFieldResponse)
def content_suggest_field(req: SuggestFieldRequest):
    value = suggest_field(req.field, {
        "vehicle": req.vehicle,
        "theme": req.theme,
        "channel": req.channel,
        "campaign_name": req.campaign_name,
        "current": req.current,
    })
    return SuggestFieldResponse(value=value)


# ── Campaign Planning (Agent 1) ───────────────────────────────────────────────

@router.post("/campaigns/plan", response_model=CampaignPlanResponse)
def plan_campaign(req: CampaignPlanRequest):
    result = campaign_planning_agent.invoke({
        "campaign_name": req.campaign_name,
        "campaign_type": req.campaign_type,
        "vehicles": req.vehicles,
        "goal": req.goal,
        "start_date": req.start_date,
        "end_date": req.end_date,
        "posting_time": req.posting_time,
        "notes": req.notes,
        "selected_assets": req.selected_assets,
        "detected_events": [],
        "themes": [],
        "result": None,
    })
    days_raw: list[dict] = result.get("result") or []
    fallback_vehicle = (req.selected_assets[0].get("vehicle") if req.selected_assets else None) or (req.vehicles[0] if req.vehicles else "Magnite")
    days = [
        CampaignDay(
            day_num=d.get("day_num", i + 1),
            date=d.get("date", ""),
            theme=d.get("theme", f"Day {i + 1}"),
            vehicle=d.get("vehicle") or fallback_vehicle,
            asset_id=d.get("asset_id"),
        )
        for i, d in enumerate(days_raw)
    ]
    return CampaignPlanResponse(days=days)


# ── /agents/* endpoints ───────────────────────────────────────────────────────

@router.post("/agents/campaign-planner", response_model=CampaignPlanResponse)
def agents_campaign_planner(req: CampaignPlanRequest):
    return plan_campaign(req)


@router.post("/agents/content-studio", response_model=ContentResponse)
def agents_content_studio(req: ContentRequest):
    return generate_content(req)


@router.post("/agents/compliance", response_model=ComplianceResponse)
def agents_compliance(req: ComplianceRequest):
    return check_compliance(req)


@router.post("/agents/publish", response_model=PublishResponse)
def agents_publish(req: PublishRequest):
    result = publishing_agent.invoke({
        "post_id": req.post_id,
        "campaign_id": req.campaign_id,
        "channel": req.channel,
        "scheduled_at": req.scheduled_at,
        "content": req.content,
        "result": None,
    })
    data: dict = result.get("result") or {}
    return PublishResponse(
        published=data.get("published", False),
        platform_post_id=data.get("platform_post_id"),
        channel=data.get("channel"),
        published_at=data.get("published_at"),
        error=data.get("error"),
    )


# ── Brand Compliance (Agent 5) ────────────────────────────────────────────────

@router.post("/compliance/check", response_model=ComplianceResponse)
def check_compliance(req: ComplianceRequest):
    result = compliance_agent.invoke({
        "caption": req.caption,
        "hashtags": req.hashtags,
        "offer": req.offer,
        "channel": req.channel,
        "result": None,
    })
    data: dict = result.get("result") or {}
    return ComplianceResponse(
        compliance=data.get("compliance", "unchecked"),
        flags=data.get("flags", []),
    )


# ── Poster Generation (Agent 4) ──────────────────────────────────────────────

@router.post("/poster/generate", response_model=PosterResponse)
def generate_poster(req: PosterRequest):
    """Craft a poster prompt + headline via Gemini. Image generation is disabled —
    no working image provider is available with the current credentials, so
    poster_image_url is always None (Content Studio renders text only)."""
    poster_prompt = (
        f"Cinematic Nissan {req.vehicle} automotive marketing poster, "
        f"dramatic studio lighting, car positioned dynamically"
        + (f" with {req.theme} theme" if req.theme else "")
        + ", Nissan red accent color, dark luxury background, "
        "professional commercial photography, 8K resolution, highly detailed, no text overlay"
    )
    headline = f"Drive the Nissan {req.vehicle}"
    offer_badge: Optional[str] = req.offer or None

    if has_llm():
        lm_data = llm_json(
            (
                f'Design a social poster for the Nissan {req.vehicle} on {req.channel}.'
                + (f' Occasion/theme: {req.theme}.' if req.theme else '')
                + (f' Offer: {req.offer}.' if req.offer else '')
                + ' Return JSON: {"headline":"2-5 word poster headline","offer_badge":"short badge or empty string",'
                '"poster_prompt":"vivid image-generation prompt (composition, lighting, Nissan red accent, dealership branding, social-ready)"}'
            ),
            system="You are a creative director. Respond ONLY with valid JSON, no markdown.",
            temperature=0.8,
            max_tokens=400,
        )
        if lm_data:
            if lm_data.get("poster_prompt"):
                poster_prompt = lm_data["poster_prompt"]
            if lm_data.get("headline"):
                headline = lm_data["headline"]
            if str(lm_data.get("offer_badge", "")).strip():
                offer_badge = str(lm_data["offer_badge"]).strip()

    return PosterResponse(
        poster_prompt=poster_prompt,
        headline=headline,
        offer_badge=offer_badge,
        poster_image_url=None,
    )


# ── Poster Banner (Gemini 3 image — real car photo composited on festive scene) ─

class BannerRequest(BaseModel):
    kind: str = "campaign"          # "campaign" | "event"
    title: str = ""                 # campaign name or event name
    theme: str = ""                 # day theme / event name
    headline: str = ""              # greeting headline rendered on the poster
    vehicle: Optional[str] = None
    offer: Optional[str] = None
    channel: Optional[str] = None
    image_b64: Optional[str] = None # car photo (create) OR existing poster (refine), base64
    image_mime: str = "image/jpeg"
    logo_b64: Optional[str] = None  # user-selected logo, base64 — MUST be used as-is
    logo_mime: str = "image/png"
    instructions: Optional[str] = None  # extra user art-direction / refine comment
    mode: str = "create"            # "create" | "refine"
    force_regenerate: bool = False  # skip disk cache; always call Gemini
    # routing — where to file the saved poster
    campaign_id: Optional[str] = None
    event_id: Optional[str] = None
    day_num: Optional[int] = None
    day_date: Optional[str] = None  # YYYY-MM-DD

class BannerResponse(BaseModel):
    image_b64: str
    mime: str
    path: str                       # served path, e.g. /posters/campaigns/<id>/day01_2026-06-12.png


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s or "")[:80] or "x"


def _event_stem(req: "BannerRequest") -> str:
    """Clean filename stem for event posters: YYYY-MM-DD_EventName."""
    date_part = _safe(req.day_date or "undated")
    name_part = _safe(req.theme or req.title or "event")
    return f"{date_part}_{name_part}"


def _save_poster(req: "BannerRequest", data: bytes, ext: str) -> str:
    """Write the poster under a structured folder and return its /posters/… path."""
    if req.kind == "campaign" and req.campaign_id:
        rel = Path("campaigns") / _safe(req.campaign_id) / f"day{(req.day_num or 0):02d}_{_safe(req.day_date or 'date')}.{ext}"
    elif req.kind == "event":
        ym = (req.day_date or "")[:7] or "undated"
        rel = Path("events") / ym / f"{_event_stem(req)}.{ext}"
    else:
        rel = Path("misc") / f"{uuid.uuid4().hex}.{ext}"
    dest = POSTERS_DIR / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return "/posters/" + rel.as_posix()


def _find_existing_poster(req: "BannerRequest") -> "Path | None":
    """Return the path of an existing poster file for this request, or None."""
    if req.kind == "campaign" and req.campaign_id:
        stem = f"day{(req.day_num or 0):02d}_{_safe(req.day_date or 'date')}"
        parent = POSTERS_DIR / "campaigns" / _safe(req.campaign_id)
    elif req.kind == "event":
        ym = (req.day_date or "")[:7] or "undated"
        stem = _event_stem(req)
        parent = POSTERS_DIR / "events" / ym
    else:
        return None
    for ext in ("jpg", "png"):
        candidate = parent / f"{stem}.{ext}"
        if candidate.exists():
            return candidate
    return None


@router.post("/poster/banner", response_model=BannerResponse)
def poster_banner(req: BannerRequest):
    # For create mode: return existing file if already on disk (avoids Gemini re-call
    # when the DB write failed or the user re-opens the campaign).
    # force_regenerate=True bypasses this cache entirely and deletes the old file.
    if req.mode == "create" and not req.force_regenerate:
        existing = _find_existing_poster(req)
        if existing:
            try:
                data = existing.read_bytes()
                b64 = base64.b64encode(data).decode()
                ext = existing.suffix.lstrip(".")
                mime = "image/png" if ext == "png" else "image/jpeg"
                path = "/posters/" + existing.relative_to(POSTERS_DIR).as_posix()
                logger.info("[poster] cached on disk → %s", path)
                return BannerResponse(image_b64=b64, mime=mime, path=path)
            except Exception as exc:
                logger.warning("[poster] disk read failed (%s) — regenerating", exc)
    elif req.force_regenerate:
        existing = _find_existing_poster(req)
        if existing:
            try:
                existing.unlink()
                logger.info("[poster] force_regenerate — deleted cached %s", existing)
            except Exception as exc:
                logger.warning("[poster] could not delete cached poster (%s)", exc)

    # Master prompt assembled in app/poster_prompt.py (single source of truth).
    prompt = build_poster_prompt(
        kind=req.kind, title=req.title, theme=req.theme, headline=req.headline,
        vehicle=req.vehicle, offer=req.offer, channel=req.channel,
        has_car_image=bool(req.image_b64), has_logo=bool(req.logo_b64),
        instructions=req.instructions, mode=req.mode,
    )
    result = gemini_image(prompt, req.image_b64, req.image_mime, req.logo_b64, req.logo_mime)
    if not result:
        raise HTTPException(status_code=502, detail="Image generation failed — check Gemini key/quota (see API logs).")
    b64, mime = result
    ext = "png" if "png" in mime else "jpg"
    try:
        path = _save_poster(req, base64.b64decode(b64), ext)
        logger.info("[poster] saved → %s", path)
    except Exception as exc:
        logger.warning("[poster] save failed (%s) — returning b64 only", exc)
        path = ""
    return BannerResponse(image_b64=b64, mime=mime, path=path)


@router.post("/poster/regenerate", response_model=BannerResponse)
def poster_regenerate(req: BannerRequest):
    """Force-regenerate a poster, ignoring any cached file on disk."""
    req.force_regenerate = True
    return poster_banner(req)


# ── Content Studio video attachment (YouTube publish needs a real video file,
# unlike the image/text channels — see app/routers/publish.py's youtube branch
# and app/services/youtube.py's upload_video) ────────────────────────────────

class VideoUploadResponse(BaseModel):
    video_url: str   # served path, e.g. /videos/<tenant_id>/<uuid>.mp4


@router.post("/video/upload", response_model=VideoUploadResponse)
async def video_upload(tenant_id: str = Form(...), video: UploadFile = File(...)):
    """Save a Content Studio video attachment to disk and return its served
    path. Mirrors _save_poster's role for images — the returned path is what
    gets persisted as campaign_days.video_url / opportunities.video_url."""
    ext = Path(video.filename or "").suffix.lower()
    if ext not in _ALLOWED_VIDEO_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported video format '{ext}'. Allowed: {sorted(_ALLOWED_VIDEO_EXT)}")

    contents = await video.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > _MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_VIDEO_BYTES // (1024 * 1024)} MB limit")

    dest_dir = VIDEOS_DIR / _safe(tenant_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    (dest_dir / fname).write_bytes(contents)

    video_url = f"/videos/{_safe(tenant_id)}/{fname}"
    logger.info("[video:upload] tenant=%s saved → %s (%d bytes)", tenant_id, video_url, len(contents))
    return VideoUploadResponse(video_url=video_url)


# ── Marketing Copilot (Agent 8) ───────────────────────────────────────────────

@router.post("/copilot/ask", response_model=CopilotResponse)
def copilot_ask(req: CopilotRequest):
    result = copilot_agent.invoke({
        "question": req.question,
        "campaign_context": req.campaign_context,
        "snapshot_context": req.snapshot_context,
        "result": None,
    })
    return CopilotResponse(answer=result.get("result") or "No answer available.")


# ── Month Plan / Calendar (Agent 1 data feed) ─────────────────────────────────

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_CALENDARIFIC_UA = _BROWSER_UA

# Google's public India holiday calendar — free, no key/OAuth, no rate limit,
# exact (incl. lunar) festival dates. Primary source for monthly events.
_GOOGLE_ICAL_URL = (
    "https://calendar.google.com/calendar/ical/"
    "en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics"
)
# Cache the whole parsed calendar for the process lifetime (refresh after 12h).
_ical_cache: dict = {"fetched_at": 0.0, "events": []}  # events: [(YYYYMMDD, summary)]


def _classify_occasion(name: str) -> str:
    n = name.lower()
    if any(w in n for w in ["republic day", "independence day", "gandhi", "new year", "labour", "may day"]):
        return "holiday"
    if any(w in n for w in ["pongal", "onam", "ugadi", "gudi padwa", "puthandu", "tamil", "bihu", "vishu", "sankranti"]):
        return "regional"
    if any(w in n for w in [
        "diwali", "deepavali", "holi", "eid", "ramadan", "ramzan", "navratri", "dussehra",
        "ganesh", "janmashtami", "raksha", "shivaratri", "jayanti", "purnima", "panchami",
        "navami", "chaturthi", "christmas", "muharram", "ashura", "bakrid", "guru", "puja", "navaratri",
    ]):
        return "festival"
    return "dealership"


async def _fetch_google_ical(month: int, year: int) -> list[dict]:
    """India holidays from Google's public iCal feed. [] on failure."""
    import time
    import re
    try:
        if not _ical_cache["events"] or (time.monotonic() - _ical_cache["fetched_at"]) > 43200:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                resp = await client.get(_GOOGLE_ICAL_URL, headers={"User-Agent": _BROWSER_UA})
            if resp.status_code != 200:
                logger.warning("[month-plan] Google iCal HTTP %s", resp.status_code)
                return []
            events: list[tuple[str, str]] = []
            for ev in re.findall(r"BEGIN:VEVENT.*?END:VEVENT", resp.text, re.S):
                d = re.search(r"DTSTART(?:;VALUE=DATE)?:(\d{8})", ev)
                s = re.search(r"SUMMARY:(.+)", ev)
                if d and s:
                    events.append((d.group(1), s.group(1).strip().replace("\\,", ",")))
            _ical_cache["events"] = events
            _ical_cache["fetched_at"] = time.monotonic()
            logger.info("[month-plan] Google iCal cached %d events", len(events))

        prefix = f"{year}{month:02d}"
        out: list[dict] = []
        for ymd, summary in _ical_cache["events"]:
            if ymd.startswith(prefix):
                iso = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"
                out.append({
                    "date": iso,
                    "name": summary,
                    "kind": _classify_occasion(summary),
                    "theme": summary,
                    "suggestion": f"{summary} — build a themed dealership campaign around this occasion.",
                })
        logger.info("[month-plan] Google iCal → %d events for %s", len(out), prefix)
        return out
    except Exception as exc:
        logger.warning("[month-plan] Google iCal failed (%s)", exc)
        return []


async def _fetch_calendarific(month: int, year: int) -> list[dict]:
    """Query Calendarific for India holidays. Returns mapped opportunities, or
    [] on any failure (no key, Cloudflare 403, rate-limit 429, future-year)."""
    if not CALENDARIFIC_API_KEY:
        logger.info("[month-plan] no CALENDARIFIC_API_KEY — using fallback calendar")
        return []
    url = (
        f"https://calendarific.com/api/v2/holidays"
        f"?api_key={CALENDARIFIC_API_KEY}&country=IN&year={year}&month={month}"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"User-Agent": _CALENDARIFIC_UA, "Accept": "application/json"})
        if resp.status_code != 200:
            logger.warning("[month-plan] Calendarific HTTP %s: %s — using fallback", resp.status_code, resp.text[:200])
            return []
        data = resp.json()
        holidays: list[dict] = data.get("response", {}).get("holidays", [])
        prefix = f"{year}-{str(month).zfill(2)}"
        filtered = [h for h in holidays if h.get("date", {}).get("iso", "").startswith(prefix)]
        logger.info("[month-plan] Calendarific returned %d holidays for %s", len(filtered), prefix)
        return [
            {
                "date": h["date"]["iso"][:10],
                "name": h["name"],
                "kind": _map_kind(h.get("type", [])),
                "theme": h["name"],
                "suggestion": h.get("description") or f"{h['name']} — great opportunity for dealership promotions.",
            }
            for h in filtered
        ]
    except Exception as exc:
        logger.warning("[month-plan] Calendarific call failed (%s) — using fallback", exc)
        return []


@router.get("/calendar/month-plan")
async def month_plan(month: int, year: int):
    from app.calendar_data import fallback_opportunities

    # Source priority: Google iCal (free, exact festivals) → Calendarific → none.
    opportunities = await _fetch_google_ical(month, year)
    source = "google-ical"
    if not opportunities:
        opportunities = await _fetch_calendarific(month, year)
        source = "calendarific"

    if not opportunities:
        # Fully offline: deterministic India/Tamil Nadu calendar.
        opportunities = fallback_opportunities(month, year)
        source = "fallback"
    else:
        # Merge dealer-marketing days the holiday feeds omit (Father's Day,
        # World Environment Day, June Solstice, Mother's/Children's Day, …).
        seen = {o["name"].lower() for o in opportunities}
        for o in fallback_opportunities(month, year):
            if o["kind"] == "dealership" and o["name"].lower() not in seen:
                opportunities.append(o)

    opportunities.sort(key=lambda o: o["date"])
    logger.info("[month-plan] %d-%02d → %d opportunities (source=%s)", year, month, len(opportunities), source)
    return {"month": month, "year": year, "opportunities": opportunities}


# ── Campaign wizard AI-suggest (NVIDIA NIM) ──────────────────────────────────

@router.post("/campaign/suggest-description", response_model=SuggestDescriptionResponse)
def suggest_campaign_description(req: SuggestDescriptionRequest):
    if not has_llm():
        return SuggestDescriptionResponse(description=None)
    data = llm_json(
        (
            f'Write a 2–3 sentence campaign description for a Nissan dealership campaign: "{req.campaign_name}". '
            f'Type: {req.campaign_type}. Occasion: {req.occasion or "general"}. '
            'Keep it concise and action-oriented for the marketing team. '
            'Return JSON: {"description": "..."}'
        ),
        system=BRAND_SYSTEM_PROMPT,
        temperature=0.7,
        max_tokens=300,
    )
    return SuggestDescriptionResponse(description=(data or {}).get("description"))


@router.post("/campaign/suggest-hashtags", response_model=SuggestHashtagsResponse)
def suggest_campaign_hashtags(req: SuggestHashtagsRequest):
    if not has_llm():
        return SuggestHashtagsResponse(hashtags=[])
    city = req.region.split()[0] if req.region else "Chennai"
    data = llm_json(
        (
            f'Generate 8 campaign hashtags for Nissan campaign "{req.campaign_name}". '
            f'Type: {req.campaign_type}. Region: {req.region} (city: {city}). '
            f'Occasion: {req.occasion or "general"}. '
            'Always include #Nissan and #NissanIndia. '
            f'Mix campaign-specific, vehicle, regional (#{city}), and occupation hashtags. '
            'Return JSON: {"hashtags": ["#tag1", "#tag2", ...]}'
        ),
        system=BRAND_SYSTEM_PROMPT,
        temperature=0.7,
        max_tokens=300,
    )
    hashtags = (data or {}).get("hashtags", [])
    return SuggestHashtagsResponse(hashtags=hashtags if isinstance(hashtags, list) else [])


def _map_kind(types: list[str]) -> str:
    joined = " ".join(types).lower()
    if any(t in joined for t in ["national", "public", "common local"]):
        return "holiday"
    if any(t in joined for t in ["local", "state", "observance"]):
        return "regional"
    if any(t in joined for t in ["religious", "hindu", "muslim", "christian", "jewish", "buddhist", "sikh"]):
        return "festival"
    return "dealership"


# ── Recommended Campaigns (Agent 2 — rule-based) ─────────────────────────────

@router.get("/campaigns/recommended")
def recommended_campaigns():
    return [
        {"title": "Push the Magnite this month", "rationale": "Magnite drives ~42% of your leads — double down with a dedicated SUV-compact campaign.", "priority": "high", "vehicle": "Magnite"},
        {"title": "Promote the SUV segment", "rationale": "Rising SUV demand in your region; bundle X-Trail + Magnite with festive finance.", "priority": "high", "vehicle": "X-Trail"},
        {"title": "Weekend test-drive drive", "rationale": "Walk-ins convert 3x better after a test drive — run a weekend booking campaign.", "priority": "medium", "vehicle": None},
        {"title": "Monsoon service & accessories", "rationale": "Seasonal service revenue + re-engagement of existing customers.", "priority": "low", "vehicle": None},
    ]
