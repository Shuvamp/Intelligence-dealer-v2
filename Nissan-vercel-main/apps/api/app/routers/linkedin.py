"""LinkedIn channel API — status, profile, sync, insights, organizations, disconnect."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import channel_store, linkedin_analytics_store as analytics_store
from app.services.linkedin import get_profile_url, list_admin_organizations, verify_token

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
    LinkedIn insights read from stored snapshots (written by the background
    analytics poller, app/services/linkedin_analytics_poller.py) — not fetched
    live, so this loads instantly regardless of LinkedIn API latency.

    Likes/comments/engagement work for any connected account (member API).
    Reach/impressions/shares/engagement rate/followers growth/profile views
    only populate once a Company Page (Organization) is connected AND the
    LinkedIn Developer App has Marketing Developer Platform access — until
    then their `status` is "mdp_required" (org connected, blocked) or
    "unavailable" (no org connected yet), which the frontend renders as the
    required messaging instead of a bare 0.
    """
    empty = {
        "connected": False, "handle": None, "last_sync": None,
        "analyticsAccess": "member",
        "postsTracked": 0, "postsWithStats": 0,
        "likes": 0, "comments": 0, "engagement": 0, "avgEngagementPerPost": 0,
        "reach": None, "impressions": None, "shares": None, "clicks": None,
        "engagementRate": None, "followersGrowth": None, "profileViews": None,
        "orgMetricsStatus": "unavailable", "accountMetricsStatus": "unavailable",
        "topPosts": [], "posts": [],
    }

    row = channel_store.get(tenant_id, "linkedin")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        return empty

    org_urn = row.get("linkedin_org_urn")
    posts = await analytics_store.get_posts_for_tenant(tenant_id)
    if date_from:
        posts = [p for p in posts if (p.get("published_at") or "") >= date_from]
    if date_to:
        posts = [p for p in posts if (p.get("published_at") or "") <= date_to]

    latest_metrics = await analytics_store.get_latest_post_metrics(tenant_id)
    account_metrics = await analytics_store.get_latest_account_metrics(tenant_id) if org_urn else None

    per: list[dict] = []
    likes = comments = 0
    reach_sum = impressions_sum = shares_sum = clicks_sum = 0
    engagement_rates: list[float] = []
    org_status = "unavailable"
    for p in posts:
        m = latest_metrics.get(p["urn"])
        if not m:
            continue
        likes += m.get("likes") or 0
        comments += m.get("comments") or 0
        if m.get("status") == "ok" and m.get("impressions") is not None:
            reach_sum += m.get("reach") or 0
            impressions_sum += m.get("impressions") or 0
            shares_sum += m.get("shares") or 0
            clicks_sum += m.get("clicks") or 0
            if m.get("engagement_rate") is not None:
                engagement_rates.append(m["engagement_rate"])
        if m.get("status") in ("mdp_required", "ok"):
            org_status = m["status"]
        per.append({
            "urn": p["urn"],
            "title": p.get("title") or (p.get("caption") or "Untitled post")[:80],
            "caption": p.get("caption"),
            "imageUrl": p.get("image_url"),
            "at": p.get("published_at"),
            "likes": m.get("likes"),
            "comments": m.get("comments"),
            "shares": m.get("shares"),
            "impressions": m.get("impressions"),
            "reach": m.get("reach"),
            "clicks": m.get("clicks"),
            "engagementRate": m.get("engagement_rate"),
            "status": m.get("status"),
        })

    engagement = likes + comments
    has_org_data = org_status == "ok"
    top = sorted(per, key=lambda x: (x["likes"] or 0) + (x["comments"] or 0), reverse=True)[:10]

    return {
        "connected": True,
        "handle": row.get("handle"),
        "last_sync": row.get("last_sync"),
        "analyticsAccess": "organization" if org_urn else "member",
        "postsTracked": len(posts),
        "postsWithStats": len(per),
        "likes": likes,
        "comments": comments,
        "engagement": engagement,
        "avgEngagementPerPost": round(engagement / len(per), 1) if per else 0,
        "reach": reach_sum if has_org_data else None,
        "impressions": impressions_sum if has_org_data else None,
        "shares": shares_sum if has_org_data else None,
        "clicks": clicks_sum if has_org_data else None,
        "engagementRate": round(sum(engagement_rates) / len(engagement_rates), 4) if engagement_rates else None,
        "followersGrowth": (account_metrics or {}).get("followers_growth") if account_metrics and account_metrics.get("status") == "ok" else None,
        "profileViews": (account_metrics or {}).get("profile_views") if account_metrics and account_metrics.get("status") == "ok" else None,
        "orgMetricsStatus": org_status if org_urn else "unavailable",
        "accountMetricsStatus": (account_metrics or {}).get("status", "unavailable") if org_urn else "unavailable",
        "topPosts": top,
        "posts": per,
    }


@router.get("/organizations")
async def linkedin_organizations(tenant_id: str = Query(...)):
    """List Company Pages (Organizations) the connected member administers.
    Only meaningful once LINKEDIN_ORG_SCOPES_ENABLED is on and the member
    reconnected with the rw_organization_admin scope — otherwise LinkedIn
    returns 403 and this surfaces "mdp_required"."""
    row = channel_store.get(tenant_id, "linkedin")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=404, detail="No LinkedIn connection found")
    result = await list_admin_organizations(row["access_token"])
    if isinstance(result, str):
        return {"status": result, "organizations": []}
    return {"status": "ok", "organizations": result}


class SelectOrganizationRequest(BaseModel):
    tenant_id: str
    org_urn: str
    org_name: str | None = None


@router.post("/organizations/select")
async def linkedin_select_organization(req: SelectOrganizationRequest):
    row = channel_store.get(req.tenant_id, "linkedin")
    if not row:
        raise HTTPException(status_code=404, detail="No LinkedIn connection found")
    channel_store.update(
        req.tenant_id, "linkedin",
        linkedin_org_urn=req.org_urn, linkedin_org_name=req.org_name,
    )
    return {"status": "success", "org_urn": req.org_urn, "org_name": req.org_name}


class RefreshAnalyticsRequest(BaseModel):
    tenant_id: str


@router.post("/analytics/refresh")
async def linkedin_refresh_analytics(req: RefreshAnalyticsRequest):
    """Manually run one analytics poll for a single tenant (the dashboard's
    "Refresh analytics" button) instead of waiting for the next scheduled tick."""
    row = channel_store.get(req.tenant_id, "linkedin")
    if not row or row.get("status") != "connected" or not row.get("access_token"):
        raise HTTPException(status_code=400, detail="LinkedIn is not connected")
    from app.services.linkedin_analytics_poller import refresh_tenant
    try:
        await refresh_tenant(req.tenant_id, row)
    except Exception:  # noqa: BLE001
        logger.exception("[linkedin:analytics] manual refresh failed tenant=%s", req.tenant_id)
        raise HTTPException(status_code=502, detail="LinkedIn analytics refresh failed")
    return {"status": "success"}


@router.post("/disconnect")
async def linkedin_disconnect(req: DisconnectRequest):
    row = channel_store.get(req.tenant_id, "linkedin")
    if not row:
        raise HTTPException(status_code=404, detail="No LinkedIn connection found")
    channel_store.update(req.tenant_id, "linkedin", status="disconnected", access_token="")
    return {"status": "success", "message": "LinkedIn disconnected"}
