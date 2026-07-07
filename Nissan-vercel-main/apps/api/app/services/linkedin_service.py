"""
Thin re-export of the LinkedIn service for import ergonomics.

All logic lives in app.services.linkedin — this module exists so agent and
tool code can ``from app.services.linkedin_service import ...`` without
importing from a file that also contains OAuth helpers.
"""
from app.services.linkedin import (  # noqa: F401
    LinkedInPublishError,
    build_oauth_url,
    create_ugc_post,
    exchange_code_for_token,
    get_member_urn,
    get_post_stats,
    get_profile_url,
    get_user_profile,
    publish_post,
    register_image_upload,
    upload_image_binary,
    verify_token,
)
