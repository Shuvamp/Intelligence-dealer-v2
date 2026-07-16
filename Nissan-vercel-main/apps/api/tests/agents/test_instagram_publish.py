"""Unit tests for Instagram publishing (app/services/instagram.py).

Covers to_public_url()'s relative→absolute resolution and publish_post()'s
two-step Graph API flow (media container -> media_publish), including the
error path. No network calls — httpx.AsyncClient.post is mocked.
"""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import Response

from app.services.instagram import InstagramPublishError, publish_post, to_public_url


def test_to_public_url_passes_through_absolute_urls():
    assert to_public_url("https://cdn.example.com/x.png") == "https://cdn.example.com/x.png"
    assert to_public_url("http://cdn.example.com/x.png") == "http://cdn.example.com/x.png"


def test_to_public_url_resolves_relative_paths():
    assert to_public_url("/posters/x.png") == "http://localhost:8000/posters/x.png"
    assert to_public_url("posters/x.png") == "http://localhost:8000/posters/x.png"


@pytest.mark.asyncio
async def test_publish_post_success():
    create_resp = Response(200, json={"id": "creation-123"})
    publish_resp = Response(200, json={"id": "media-456"})
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=[create_resp, publish_resp])):
        result = await publish_post("ig-user-1", "token", "hello world", "https://cdn.example.com/x.png")
    assert result == {"status": "success", "post_id": "media-456"}


@pytest.mark.asyncio
async def test_publish_post_fails_on_media_creation_error():
    error_resp = Response(400, json={"error": {"message": "Invalid image_url"}})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=error_resp)):
        with pytest.raises(InstagramPublishError, match="Invalid image_url"):
            await publish_post("ig-user-1", "token", "hello", "https://cdn.example.com/x.png")


@pytest.mark.asyncio
async def test_publish_post_fails_on_media_publish_error():
    create_resp = Response(200, json={"id": "creation-123"})
    error_resp = Response(400, json={"error": {"message": "Media not ready"}})
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=[create_resp, error_resp])):
        with pytest.raises(InstagramPublishError, match="Media not ready"):
            await publish_post("ig-user-1", "token", "hello", "https://cdn.example.com/x.png")
