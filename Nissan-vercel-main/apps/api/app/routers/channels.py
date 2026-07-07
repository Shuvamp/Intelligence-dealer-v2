"""Channels API — list all social channel connections for a tenant."""
from fastapi import APIRouter, Query

from app.services import channel_store

router = APIRouter()

# Channels the UI always renders, even when not connected.
_ALL_CHANNELS = ["instagram", "facebook", "linkedin", "google_business", "whatsapp"]


def _account_fields(channel: str, row: dict) -> tuple[str | None, str | None]:
    """Per-channel (account_id, account_name) drawn from the stored connection.

    Each platform keys its identity differently in channel_store, so map them to
    a common (id, name) pair the Connected Studio UI can render uniformly.
    """
    if channel == "instagram":
        return row.get("instagram_id"), (row.get("page_name") or row.get("handle"))
    if channel == "facebook":
        return row.get("page_id"), row.get("page_name")
    if channel == "linkedin":
        return row.get("linkedin_id"), (row.get("handle") or row.get("page_name"))
    # google_business / whatsapp: no identity persisted yet.
    return None, None


@router.get("")
async def list_channels(tenant_id: str = Query(...)):
    """
    Return connection status for every channel.
    Connected channels come from the local store; the rest default to disconnected.
    Shape matches the frontend ChannelConnection type (incl. account_id/account_name).
    """
    rows = {r["channel"]: r for r in channel_store.list_for_tenant(tenant_id)}
    result = []
    for channel in _ALL_CHANNELS:
        row = rows.get(channel)
        if row:
            account_id, account_name = _account_fields(channel, row)
            result.append({
                "channel": channel,
                "status": row.get("status", "disconnected"),
                "handle": row.get("handle"),
                "last_sync": row.get("last_sync"),
                "account_id": account_id,
                "account_name": account_name,
            })
        else:
            result.append({
                "channel": channel,
                "status": "disconnected",
                "handle": None,
                "last_sync": None,
                "account_id": None,
                "account_name": None,
            })
    return result
