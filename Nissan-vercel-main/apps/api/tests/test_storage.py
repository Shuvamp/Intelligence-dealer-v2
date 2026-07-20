"""Self-check for app/storage.py against local Supabase Storage.

Run: python apps/api/tests/test_storage.py
Requires `supabase start` running locally (uses SUPABASE_URL/SUPABASE_SERVICE_KEY from .env).
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import storage
from app.config import SUPABASE_POSTERS_BUCKET


def main() -> None:
    key = f"_selfcheck/{uuid.uuid4().hex}.txt"
    payload = b"supabase storage self-check"

    url = storage.upload(SUPABASE_POSTERS_BUCKET, key, payload, "text/plain")
    assert url, "upload() did not return a public URL"

    assert storage.exists(SUPABASE_POSTERS_BUCKET, key) is True

    downloaded = storage.download(SUPABASE_POSTERS_BUCKET, key)
    assert downloaded == payload, "downloaded bytes do not match uploaded bytes"

    missing = storage.download(SUPABASE_POSTERS_BUCKET, f"_selfcheck/{uuid.uuid4().hex}.txt")
    assert missing is None, "download() of a missing object should return None"

    storage.remove(SUPABASE_POSTERS_BUCKET, key)
    assert storage.exists(SUPABASE_POSTERS_BUCKET, key) is False

    print("OK: storage.py upload/exists/download/remove round-trip passed")


if __name__ == "__main__":
    main()
