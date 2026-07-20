import logging
from supabase import create_client, Client
from storage3.exceptions import StorageApiError  # noqa: F401 — re-exported for callers
from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

logger = logging.getLogger(__name__)
_client: Client | None = None


def _sb() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def upload(bucket: str, path: str, data: bytes, content_type: str) -> str:
    _sb().storage.from_(bucket).upload(path, data, {"content-type": content_type, "upsert": "true"})
    return _sb().storage.from_(bucket).get_public_url(path)


def public_url(bucket: str, path: str) -> str:
    return _sb().storage.from_(bucket).get_public_url(path)


def exists(bucket: str, path: str) -> bool:
    try:
        return _sb().storage.from_(bucket).exists(path)
    except StorageApiError:
        return False


def download(bucket: str, path: str) -> bytes | None:
    try:
        return _sb().storage.from_(bucket).download(path)
    except StorageApiError:
        return None


def remove(bucket: str, path: str) -> None:
    try:
        _sb().storage.from_(bucket).remove([path])
    except StorageApiError as exc:
        logger.warning("[storage] remove failed bucket=%s path=%s (%s)", bucket, path, exc)
