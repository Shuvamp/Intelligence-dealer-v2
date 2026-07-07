"""LinkedIn channel API — status, profile, sync, insights, disconnect."""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import channel_store
from app.services.linkedin import get_post_stats, get_profile_url, verify_token

logger = logging.getLogger(__name__)
router = APIRouter()


class SyncRequest(BaseModel):
    tenant_id: str


class DisconnectRequest(BaseModel):
    tenant_id: str


@router.get("/status")
async def linkedin_status(tenant_id: str = Query(...)):
    row = channel_store.get(tenant_id, "linkedin")
    if not row:
        return {"connected": False, "handle": None, "last_sync": None}
    return {
        "connected": row["status"] == "connected",
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "linkedin_id": row.get("linkedin_id"),
    }


@router.get("/profile")
async def linkedin_profile(tenant_id: str = Query(...)):
    """
    Return the connected LinkedIn profile + live connection state.

    state values (drives the UI):
      - not_connected      : no stored connection — caller should start OAuth
      - connected          : token valid, fresh profile attached
      - reconnect_required : token expired or permissions revoked — caller re-OAuths
      - error              : transient LinkedIn/network error — keep stored data, retry later

    Side effect: when the token is found invalid, the stored row is flipped to
    'disconnected' so the rest of the app reflects reality.
    """
    row = channel_store.get(tenant_id, "linkedin")
    if not row or row.get("status") != "connected" or not row.get("linkedin_id"):
        return {"state": "not_connected", "profile": None}

    # Stored profile (fallback shown if the live check can't run)
    stored = {
        "linkedin_id": row.get("linkedin_id"),
        "name": row.get("handle"),
        "email": row.get("email"),
        "picture": row.get("picture"),
        "profile_url": row.get("profile_url"),
        "last_sync": row.get("last_sync"),
    }

    state, fresh = await verify_token(row.get("access_token", ""))

    if state == "expired":
        # Token dead — mark disconnected so the card shows "Reconnect Required"
        channel_store.update(tenant_id, "linkedin", status="disconnected", access_token="")
        return {"state": "reconnect_required", "profile": stored}

    if state == "error":
        # Don't punish the user for a transient blip — show stored data
        return {"state": "error", "profile": stored}

    # LinkedIn returns locale as {"country": "US", "language": "en"} — flatten to a string.
    raw_locale = fresh.get("locale")
    if isinstance(raw_locale, dict):
        lang = raw_locale.get("language", "")
        country = raw_locale.get("country", "")
        locale = f"{lang}-{country}" if lang and country else (lang or country or None)
    else:
        locale = raw_locale

    # Lazy-fetch profile_url if not stored yet (accounts connected before this feature)
    resolved_profile_url: str | None = stored.get("profile_url")
    if not resolved_profile_url:
        resolved_profile_url = await get_profile_url(row.get("access_token", ""))
        if resolved_profile_url:
            logger.info("[linkedin:profile] lazily resolved profile_url for tenant=%s", tenant_id)

    # Valid — refresh stored profile fields from the live response
    profile = {
        "linkedin_id": fresh.get("sub") or stored["linkedin_id"],
        "name": fresh.get("name") or stored["name"],
        "email": fresh.get("email") or stored["email"],
        "picture": fresh.get("picture") or stored["picture"],
        "profile_url": resolved_profile_url,
        "given_name": fresh.get("given_name"),
        "family_name": fresh.get("family_name"),
        "email_verified": fresh.get("email_verified"),
        "locale": locale,
        "last_sync": row.get("last_sync"),
    }
    now = datetime.now(timezone.utc).isoformat()
    channel_store.update(
        tenant_id, "linkedin",
        handle=profile["name"] or row.get("handle"),
        email=profile["email"],
        picture=profile["picture"],
        profile_url=resolved_profile_url,
        last_sync=now,
    )
    profile["last_sync"] = now
    return {"state": "connected", "profile": profile}


@router.post("/sync")
async def linkedin_sync(req: SyncRequest):
    row = channel_store.get(req.tenant_id, "linkedin")
    if not row:
        raise HTTPException(status_code=404, detail="No LinkedIn connection found")
    if row.get("status") != "connected":
        raise HTTPException(status_code=400, detail="LinkedIn is not connected")

    now = datetime.now(timezone.utc).isoformat()
    channel_store.update(req.tenant_id, "linkedin", last_sync=now)
    return {"status": "success", "last_sync": now}


@router.get("/insights")
async def linkedin_insights(
    tenant_id: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    """
    Real LinkedIn insights for the connected member account.

    Available (member API): likes + comments per post (via socialActions),
    aggregated + ranked into top posts. NOT available for member tokens
    (returned null): reach, impressions, shares, followers growth, page views —
    those need an Organization page + Marketing Developer Platform access.
    """
    empty = {
        "connected": False, "handle": None, "last_sync": None,
        "postsTracked": 0, "postsWithStats": 0,
        "likes": 0, "comments": 0, "engagement": 0, "avgEngagementPerPost": 0,
        "reach": None, "impressions": None, "shares": None,
        "engagementRate": None, "followersGrowth": None, "profileViews": None,
        "topPosts": [], "posts": [],
    }

    row = channel_store.get(tenant_id, "linkedin")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        return empty

    token = row["access_token"]
    posts = channel_store.list_linkedin_posts(tenant_id)
    # Filter by capture date (ISO strings compare lexically).
    if date_from:
        posts = [p for p in posts if (p.get("created_at") or "") >= date_from]
    if date_to:
        posts = [p for p in posts if (p.get("created_at") or "") <= date_to]
    posts = posts[:25]  # cap live API calls per request

    stats = await asyncio.gather(*[get_post_stats(token, p["urn"]) for p in posts]) if posts else []

    per: list[dict] = []
    likes = comments = 0
    for p, s in zip(posts, stats):
        if not s:
            continue
        likes += s["likes"]
        comments += s["comments"]
        per.append({
            "urn": p["urn"],
            "title": p.get("title") or (p.get("caption") or "Untitled post")[:80],
            "caption": p.get("caption"),
            "likes": s["likes"],
            "comments": s["comments"],
            "at": p.get("created_at"),
        })

    engagement = likes + comments
    top = sorted(per, key=lambda x: x["likes"] + x["comments"], reverse=True)[:5]
    return {
        "connected": True,
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "postsTracked": len(posts),
        "postsWithStats": len(per),
        "likes": likes,
        "comments": comments,
        "engagement": engagement,
        "avgEngagementPerPost": round(engagement / len(per), 1) if per else 0,
        # Not available for member tokens (org + MDP only):
        "reach": None, "impressions": None, "shares": None,
        "engagementRate": None, "followersGrowth": None, "profileViews": None,
        "topPosts": top,
        "posts": per,
    }


@router.post("/disconnect")
async def linkedin_disconnect(req: DisconnectRequest):
    row = channel_store.get(req.tenant_id, "linkedin")
    if not row:
        raise HTTPException(status_code=404, detail="No LinkedIn connection found")
    channel_store.update(req.tenant_id, "linkedin", status="disconnected", access_token="")
    return {"status": "success", "message": "LinkedIn disconnected"}
