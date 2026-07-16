"""LinkedIn OAuth service — token exchange, profile fetch, and UGC publishing."""
import logging
from urllib.parse import urlencode, quote

import httpx

from app.config import (
    LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET,
    LINKEDIN_REDIRECT_URI,
    LINKEDIN_API_VERSION,
    LINKEDIN_ORG_SCOPES_ENABLED,
)

logger = logging.getLogger(__name__)

# Reuse CSRF state store from Instagram service (same in-memory map, same TTL)
from app.services.instagram import create_oauth_state, consume_oauth_state  # noqa: F401

# Org-level analytics (impressions/reach/shares/followers growth/profile views)
# need rw_organization_admin, which LinkedIn only grants once the app has
# Marketing Developer Platform (MDP) access — see LINKEDIN_ORG_SCOPES_ENABLED.
SCOPES = ["openid", "profile", "email", "w_member_social"]
if LINKEDIN_ORG_SCOPES_ENABLED:
    SCOPES = SCOPES + ["rw_organization_admin"]


def build_oauth_url(state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": LINKEDIN_CLIENT_ID,
        "redirect_uri": LINKEDIN_REDIRECT_URI,
        "state": state,
        "scope": " ".join(SCOPES),
        "prompt": "login",  # always ask for credentials — enables account switching
    }
    return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> dict:
    """Exchange auth code for LinkedIn access token (60-day token)."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": LINKEDIN_REDIRECT_URI,
                "client_id": LINKEDIN_CLIENT_ID,
                "client_secret": LINKEDIN_CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


async def get_user_profile(access_token: str) -> dict:
    """
    Fetch LinkedIn member profile via OpenID Connect /userinfo endpoint.
    Returns: sub (member ID), name, given_name, family_name, email, picture.
    Requires openid + profile + email scopes.
    """
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()


async def get_profile_url(access_token: str) -> str | None:
    """
    Fetch the member's public LinkedIn profile URL.

    Calls /v2/me?projection=(id,vanityName) — accessible with the `profile`
    scope from OIDC tokens.  Returns None if the endpoint is unavailable or
    the app hasn't been granted the required permissions.
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.linkedin.com/v2/me",
                params={"projection": "(id,vanityName)"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "LinkedIn-Version": "202304",
                },
                timeout=8,
            )
            if r.status_code == 200:
                vanity = r.json().get("vanityName")
                if vanity:
                    return f"https://www.linkedin.com/in/{vanity}/"
    except Exception:
        pass
    return None


# ── UGC publishing ────────────────────────────────────────────────────────────
# Image-share flow (LinkedIn Marketing/Share APIs, v2):
#   1. resolve member URN from /userinfo `sub`
#   2. registerUpload → get a one-time upload URL + asset URN
#   3. PUT/POST the image binary to that upload URL
#   4. create a UGC post referencing the asset URN
# Requires the `w_member_social` scope (granted at OAuth time).


class LinkedInPublishError(Exception):
    """Raised when any step of the LinkedIn publish flow fails."""


async def get_member_urn(access_token: str) -> str:
    """Return urn:li:person:{id} from the OIDC /userinfo `sub` claim."""
    profile = await get_user_profile(access_token)
    sub = profile.get("sub")
    if not sub:
        raise LinkedInPublishError("Could not resolve LinkedIn member ID from /userinfo")
    return f"urn:li:person:{sub}"


async def register_image_upload(access_token: str, owner_urn: str) -> tuple[str, str]:
    """
    Register a feed-share image upload.
    Returns (upload_url, asset_urn). The upload_url is single-use.
    """
    body = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": owner_urn,
            "serviceRelationships": [
                {"relationshipType": "OWNER", "identifier": "urn:li:userGeneratedContent"}
            ],
        }
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.linkedin.com/v2/assets?action=registerUpload",
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=15,
        )
    if r.status_code not in (200, 201):
        raise LinkedInPublishError(f"registerUpload failed ({r.status_code}): {r.text}")
    value = r.json().get("value", {})
    asset = value.get("asset")
    upload_url = (
        value.get("uploadMechanism", {})
        .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {})
        .get("uploadUrl")
    )
    if not asset or not upload_url:
        raise LinkedInPublishError(f"registerUpload returned no asset/uploadUrl: {r.text}")
    return upload_url, asset


async def upload_image_binary(upload_url: str, access_token: str, image_bytes: bytes) -> None:
    """Upload raw image bytes to the registered upload URL (PUT, POST fallback)."""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient() as client:
        r = await client.put(upload_url, headers=headers, content=image_bytes, timeout=60)
        if r.status_code in (200, 201):
            return
        # Some upload mechanisms accept POST instead of PUT
        r2 = await client.post(upload_url, headers=headers, content=image_bytes, timeout=60)
        if r2.status_code in (200, 201):
            return
    raise LinkedInPublishError(
        f"asset upload failed (PUT {r.status_code} / POST {r2.status_code}): {r2.text}"
    )


async def create_ugc_post(
    access_token: str,
    owner_urn: str,
    caption: str,
    *,
    asset_urn: str | None = None,
    title: str = "",
    description: str = "",
) -> str:
    """
    Create a published UGC post. If asset_urn is provided, posts an IMAGE share;
    otherwise a text-only share. Returns the post URN (e.g. urn:li:share:123).
    """
    if asset_urn:
        share_content = {
            "shareCommentary": {"text": caption},
            "shareMediaCategory": "IMAGE",
            "media": [
                {
                    "status": "READY",
                    "description": {"text": description or caption[:200]},
                    "media": asset_urn,
                    "title": {"text": title or "Post"},
                }
            ],
        }
    else:
        share_content = {
            "shareCommentary": {"text": caption},
            "shareMediaCategory": "NONE",
        }

    body = {
        "author": owner_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": share_content},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=20,
        )
    if r.status_code not in (200, 201):
        raise LinkedInPublishError(f"ugcPosts failed ({r.status_code}): {r.text}")
    post_id = r.headers.get("x-restli-id") or r.json().get("id")
    if not post_id:
        raise LinkedInPublishError(f"ugcPosts returned no id: {r.text}")
    return post_id


async def publish_post(
    access_token: str,
    caption: str,
    image_bytes: bytes | None = None,
    *,
    title: str = "",
    description: str = "",
) -> dict:
    """
    Full publish flow. Posts an image share when image_bytes is given, else
    a text-only share. Returns {"status": "success", "post_id": "urn:li:share:..."}.
    Raises LinkedInPublishError on any failure.
    """
    owner_urn = await get_member_urn(access_token)
    asset_urn: str | None = None
    if image_bytes:
        upload_url, asset_urn = await register_image_upload(access_token, owner_urn)
        await upload_image_binary(upload_url, access_token, image_bytes)
    post_id = await create_ugc_post(
        access_token, owner_urn, caption,
        asset_urn=asset_urn, title=title, description=description,
    )
    logger.info("[linkedin:publish] posted %s (image=%s)", post_id, bool(asset_urn))
    return {"status": "success", "post_id": post_id, "asset_urn": asset_urn}


async def get_post_stats(access_token: str, urn: str) -> dict | None:
    """
    Fetch real likes + comments for one published share/ugcPost via the
    socialActions API. Returns {"likes": int, "comments": int} or None on error.

    NOTE: reach/impressions/shares are NOT available for member posts (org +
    Marketing Developer Platform only) — only likes/comments are exposed here.
    """
    from urllib.parse import quote

    encoded = quote(urn, safe="")
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://api.linkedin.com/v2/socialActions/{encoded}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
                timeout=15,
            )
        if r.status_code != 200:
            logger.warning("[linkedin:stats] socialActions %s -> %s", urn, r.status_code)
            return None
        data = r.json()
        likes = int((data.get("likesSummary") or {}).get("totalLikes", 0) or 0)
        comments = int(
            (data.get("commentsSummary") or {}).get("aggregatedTotalComments")
            or (data.get("commentsSummary") or {}).get("count", 0)
            or 0
        )
        return {"likes": likes, "comments": comments}
    except Exception as e:  # noqa: BLE001 — degrade gracefully, never break the dashboard
        logger.warning("[linkedin:stats] %s failed: %s", urn, e)
        return None


async def verify_token(access_token: str) -> tuple[str, dict | None]:
    """
    Check whether a stored LinkedIn access token is still valid.

    Returns (state, profile):
      - ("valid", profile_dict)   token works, fresh profile attached
      - ("expired", None)         token expired or permissions revoked (401/403)
      - ("error", None)           transient LinkedIn API / network error
    """
    if not access_token:
        return ("expired", None)
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
        if r.status_code in (401, 403):
            return ("expired", None)
        r.raise_for_status()
        return ("valid", r.json())
    except httpx.HTTPStatusError:
        return ("error", None)
    except httpx.HTTPError:
        return ("error", None)


# ── Organization analytics (Community Management API / Marketing Developer
# Platform) — every call below needs the rw_organization_admin permission, only
# grantable once LinkedIn approves the app for MDP. Until then every one of
# these returns "mdp_required" (via classify_linkedin_error), which is the
# expected, correct outcome — not a bug. ─────────────────────────────────────

def _rest_headers(access_token: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Linkedin-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
    }


def classify_linkedin_error(status_code: int) -> str:
    """Map an HTTP status from a LinkedIn org-analytics call to a stable reason
    code the poller/UI can act on. 403 is the expected result for any org-only
    endpoint until the app has Marketing Developer Platform access."""
    if status_code == 401:
        return "expired_token"
    if status_code == 403:
        return "mdp_required"
    if status_code == 429:
        return "rate_limited"
    return "error"


async def list_admin_organizations(access_token: str) -> list[dict] | str:
    """
    List the Company Pages (Organizations) the connected member administers.

    Returns a list of {"urn": "urn:li:organization:...", "name": "..."} on
    success, or a classify_linkedin_error() string on failure (e.g.
    "mdp_required" when the app/token lacks rw_organization_admin).
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.linkedin.com/rest/organizationAcls",
                params={"q": "roleAssignee", "role": "ADMINISTRATOR", "state": "APPROVED"},
                headers=_rest_headers(access_token),
                timeout=15,
            )
        if r.status_code != 200:
            logger.warning("[linkedin:orgs] organizationAcls -> %s: %s", r.status_code, r.text[:300])
            return classify_linkedin_error(r.status_code)
        elements = r.json().get("elements", [])
    except Exception as e:  # noqa: BLE001
        logger.warning("[linkedin:orgs] organizationAcls failed: %s", e)
        return "error"

    orgs: list[dict] = []
    for el in elements:
        org_urn = el.get("organization") or el.get("organizationTarget")
        if not org_urn:
            continue
        name = org_urn
        try:
            org_id = org_urn.rsplit(":", 1)[-1]
            async with httpx.AsyncClient() as client:
                lr = await client.get(
                    f"https://api.linkedin.com/rest/organizations/{org_id}",
                    headers=_rest_headers(access_token),
                    timeout=10,
                )
            if lr.status_code == 200:
                data = lr.json()
                name = (data.get("localizedName") or name)
        except Exception:  # noqa: BLE001 — fall back to the URN as the display name
            pass
        orgs.append({"urn": org_urn, "name": name})
    return orgs


async def get_org_share_statistics(access_token: str, org_urn: str, urns: list[str]) -> dict | str:
    """
    Lifetime share statistics for specific posts, keyed by URN.
    Returns {urn: {"likes","comments","shares","impressions","reach","clicks","engagement_rate"}}
    on success, or a classify_linkedin_error() string on failure.
    """
    if not urns:
        return {}
    ugc_urns = [u for u in urns if ":ugcPost:" in u]
    share_urns = [u for u in urns if ":share:" in u]
    out: dict = {}

    async def _fetch(param_str: str) -> tuple[int, dict | None]:
        url = (
            "https://api.linkedin.com/rest/organizationalEntityShareStatistics"
            f"?q=organizationalEntity&organizationalEntity={quote(org_urn, safe='')}&{param_str}"
        )
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=_rest_headers(access_token), timeout=20)
        return r.status_code, (r.json() if r.status_code == 200 else None)

    try:
        if ugc_urns:
            param_str = "&".join(f"ugcPosts[{i}]={quote(u, safe='')}" for i, u in enumerate(ugc_urns))
            status, data = await _fetch(param_str)
            if status != 200:
                return classify_linkedin_error(status)
            _merge_share_stats(out, data)
        if share_urns:
            list_body = ",".join(quote(u, safe="") for u in share_urns)
            status, data = await _fetch(f"shares=List({list_body})")
            if status != 200:
                return classify_linkedin_error(status)
            _merge_share_stats(out, data)
    except Exception as e:  # noqa: BLE001
        logger.warning("[linkedin:share-stats] org=%s failed: %s", org_urn, e)
        return "error"
    return out


def _merge_share_stats(out: dict, data: dict | None) -> None:
    for el in (data or {}).get("elements", []):
        urn = el.get("ugcPost") or el.get("share")
        stats = el.get("totalShareStatistics") or {}
        if not urn:
            continue
        out[urn] = {
            "likes": int(stats.get("likeCount", 0) or 0),
            "comments": int(stats.get("commentCount", 0) or 0),
            "shares": int(stats.get("shareCount", 0) or 0),
            "impressions": int(stats.get("impressionCount", 0) or 0),
            "reach": int(stats.get("uniqueImpressionsCount", 0) or 0),
            "clicks": int(stats.get("clickCount", 0) or 0),
            "engagement_rate": float(stats.get("engagement", 0) or 0),
        }


async def get_follower_growth(access_token: str, org_urn: str, since_ms: int, until_ms: int) -> int | str:
    """Net follower growth (organic + paid) for the org in [since_ms, until_ms)."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.linkedin.com/rest/organizationalEntityFollowerStatistics",
                params={
                    "q": "organizationalEntity",
                    "organizationalEntity": org_urn,
                    "timeIntervals": f"(timeRange:(start:{since_ms},end:{until_ms}),timeGranularityType:DAY)",
                },
                headers=_rest_headers(access_token),
                timeout=20,
            )
        if r.status_code != 200:
            logger.warning("[linkedin:followers] org=%s -> %s", org_urn, r.status_code)
            return classify_linkedin_error(r.status_code)
        total = 0
        for el in r.json().get("elements", []):
            gains = el.get("followerGains") or {}
            total += int(gains.get("organicFollowerGain", 0) or 0) + int(gains.get("paidFollowerGain", 0) or 0)
        return total
    except Exception as e:  # noqa: BLE001
        logger.warning("[linkedin:followers] org=%s failed: %s", org_urn, e)
        return "error"


async def get_page_views(access_token: str, org_urn: str, since_ms: int, until_ms: int) -> int | str:
    """Total page/profile views for the org in [since_ms, until_ms)."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.linkedin.com/rest/organizationPageStatistics",
                params={
                    "q": "organization",
                    "organization": org_urn,
                    "timeIntervals": f"(timeRange:(start:{since_ms},end:{until_ms}),timeGranularityType:DAY)",
                },
                headers=_rest_headers(access_token),
                timeout=20,
            )
        if r.status_code != 200:
            logger.warning("[linkedin:pageviews] org=%s -> %s", org_urn, r.status_code)
            return classify_linkedin_error(r.status_code)
        total = 0
        for el in r.json().get("elements", []):
            views = ((el.get("totalPageStatistics") or {}).get("views") or {})
            overview = views.get("overviewPageViews") or views.get("allPageViews") or {}
            total += int(overview.get("pageViews", 0) or 0)
        return total
    except Exception as e:  # noqa: BLE001
        logger.warning("[linkedin:pageviews] org=%s failed: %s", org_urn, e)
        return "error"


async def resolve_asset_url(access_token: str, asset_urn: str) -> tuple[str, int] | None:
    """
    Resolve an uploaded image asset (urn:li:digitalmediaAsset:{id}) back to a
    temporary CDN URL for display. Returns (url, expires_at_ms) or None if the
    asset can't be resolved (e.g. still processing, or expired/deleted).
    """
    try:
        asset_id = asset_urn.rsplit(":", 1)[-1]
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://api.linkedin.com/rest/assets/{asset_id}",
                params={"fields": "mediaArtifacts,recipes,id"},
                headers=_rest_headers(access_token),
                timeout=15,
            )
        if r.status_code != 200:
            logger.warning("[linkedin:asset] %s -> %s", asset_urn, r.status_code)
            return None
        artifacts = r.json().get("mediaArtifacts") or []
        for artifact in artifacts:
            for ident in artifact.get("identifiers", []):
                url = ident.get("identifier")
                if not url:
                    continue
                expires_in_s = ident.get("identifierExpiresInSeconds")
                if expires_in_s:
                    import time
                    expires_at_ms = int(time.time() * 1000) + int(expires_in_s) * 1000
                else:
                    expires_at_ms = 0
                return url, expires_at_ms
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("[linkedin:asset] %s failed: %s", asset_urn, e)
        return None
