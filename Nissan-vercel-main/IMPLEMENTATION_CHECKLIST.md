# Instagram OAuth Implementation - Complete File List & Checklist

This document lists all files created or modified for Instagram OAuth integration.

## New Files Created

### Backend (FastAPI)

1. **Database Migration**
   - Location: `supabase/migrations/0015_social_channels.sql`
   - Purpose: Creates `social_channel_connections` table with RLS policies
   - Size: ~55 lines

2. **Instagram Models**
   - Location: `apps/api/models/instagram.py`
   - Purpose: Pydantic validation schemas for OAuth requests/responses
   - Exports: `InstagramOAuthTokenResponse`, `InstagramBusinessAccount`, `FacebookPageInfo`, `SocialChannelConnection`
   - Size: ~70 lines

3. **Instagram Service Layer**
   - Location: `apps/api/services/instagram.py`
   - Purpose: Meta Graph API interactions (OAuth, token exchange, data fetching)
   - Key Methods:
     - `get_oauth_url()` — Generate Meta login URL
     - `exchange_code_for_token()` — OAuth token exchange
     - `get_facebook_pages()` — Fetch user's Facebook Pages
     - `get_instagram_business_account()` — Fetch Instagram account details
   - Size: ~160 lines

4. **Instagram Router**
   - Location: `apps/api/routers/instagram.py`
   - Purpose: FastAPI endpoints for OAuth flow
   - Endpoints:
     - `POST /api/instagram/connect` — Start OAuth flow
     - `GET /api/instagram/callback` — Handle OAuth callback
     - `POST /api/instagram/disconnect` — Disconnect channel
     - `GET /api/instagram/status` — Get connection status
   - Size: ~240 lines

5. **Init Files**
   - `apps/api/models/__init__.py`
   - `apps/api/services/__init__.py`
   - `apps/api/routers/__init__.py`

6. **Documentation**
   - Location: `docs/INSTAGRAM_OAUTH_SETUP.md`
   - Purpose: Complete setup and implementation guide
   - Size: ~450 lines

## Modified Files

### Backend (FastAPI)

1. **Main Application**
   - File: `apps/api/main.py`
   - Change: Added Instagram router import and include
   - Lines: +2 (import, include_router)

2. **Configuration**
   - File: `apps/api/app/config.py`
   - Change: Added Meta API configuration variables
   - Added:
     ```python
     META_APP_ID
     META_APP_SECRET
     META_REDIRECT_URI
     META_API_VERSION
     ```

3. **Environment Template**
   - File: `apps/api/.env.example`
   - Change: Added Meta OAuth configuration section
   - Added: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_API_VERSION

### Frontend (React)

1. **Marketing Library (Server Functions)**
   - File: `apps/web/src/lib/marketing.ts`
   - Changes:
     - Updated `getChannelStatus()` to fetch from Supabase instead of mock data
     - Added `initiateInstagramConnection()` server function
     - Added `disconnectInstagram()` server function
   - Lines: +115 (3 new functions)

2. **Connected Channels Component**
   - File: `apps/web/src/routes/_authed/marketing.connected-channels.tsx`
   - Changes:
     - Converted to functional component with hooks
     - Added state management: `channels`, `loadingChannel`, `error`
     - Added `handleConnectInstagram()` handler
     - Added `handleDisconnectInstagram()` handler
     - Added error alert display
     - Added loading spinner during OAuth
     - Added auto-refresh on OAuth callback
   - Lines: +130 (added React hooks and handlers)

## File Summary

```
Total Files Created: 8
├── Backend: 6 files (3 new, 1 doc)
│   ├── models/instagram.py (new)
│   ├── services/instagram.py (new)
│   ├── routers/instagram.py (new)
│   ├── models/__init__.py (new)
│   ├── services/__init__.py (new)
│   ├── routers/__init__.py (new)
│   └── docs/INSTAGRAM_OAUTH_SETUP.md (new)
│
└── Database: 1 file
    └── migrations/0015_social_channels.sql (new)

Total Files Modified: 5
├── Backend: 2 files
│   ├── main.py
│   └── app/config.py
│   └── .env.example
│
└── Frontend: 2 files
    ├── lib/marketing.ts
    └── routes/_authed/marketing.connected-channels.tsx
```

## Implementation Checklist

### Phase 1: Backend Setup ✓

- [x] Create database migration for `social_channel_connections` table
- [x] Create Pydantic models for Instagram/Meta API
- [x] Create Instagram service layer with Meta Graph API integration
- [x] Create Instagram router with OAuth endpoints
- [x] Update FastAPI main.py to include Instagram router
- [x] Add Meta API configuration to config.py
- [x] Create __init__.py files for imports
- [x] Update .env.example with Meta credentials

### Phase 2: Frontend Setup ✓

- [x] Update `getChannelStatus()` to fetch from Supabase
- [x] Add `initiateInstagramConnection()` server function
- [x] Add `disconnectInstagram()` server function
- [x] Update Channels component with React hooks
- [x] Add OAuth callback handling and auto-refresh
- [x] Add error handling and loading states
- [x] Implement disconnect functionality with confirmation

### Phase 3: Meta App Configuration ⚠️ YOU MUST DO THIS

- [ ] Create Meta Developer App at https://developers.facebook.com/apps
- [ ] Get APP_ID and APP_SECRET
- [ ] Set OAuth Redirect URI: `http://localhost:8000/api/instagram/callback`
- [ ] Ensure Instagram Professional account linked to Facebook Page
- [ ] Add credentials to `apps/api/.env`

### Phase 4: Database Migration ⚠️ YOU MUST DO THIS

- [ ] Apply the migration to the hosted project: `supabase db push`, or run it via the SQL Editor
- [ ] Verify table created: query `SELECT * FROM social_channel_connections LIMIT 1` in the SQL Editor

### Phase 5: Start Services ⚠️ YOU MUST DO THIS

```bash
# Terminal 1: FastAPI backend
cd apps/api
python main.py

# Terminal 2: React frontend
cd apps/web
npm run dev
```

### Phase 6: Testing ⚠️ YOU SHOULD DO THIS

- [ ] Visit: `http://localhost:3000/_authed/marketing/connected-channels`
- [ ] Click "Connect Instagram"
- [ ] Log in with Meta account
- [ ] Authorize app
- [ ] Verify redirect back to Channels page
- [ ] Verify Instagram status shows "Connected"
- [ ] Verify username and profile picture display
- [ ] Test disconnect button
- [ ] Test reconnect flow

## Environment Variables Required

### `apps/api/.env`

```bash
# Existing (keep as is — hosted project URL/key)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=...

# NEW - Add these from Meta Developer Dashboard
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_REDIRECT_URI=http://localhost:8000/api/instagram/callback
META_API_VERSION=v20.0
```

### `apps/web/.env.local`

```bash
# No changes needed - frontend calls backend endpoints
# Keep existing Supabase settings
```

## Endpoints Overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/instagram/connect` | Start OAuth flow |
| GET | `/api/instagram/callback` | OAuth callback (automatic) |
| POST | `/api/instagram/disconnect` | Disconnect channel |
| GET | `/api/instagram/status` | Get connection status |

## Data Flow

```
1. User clicks "Connect Instagram"
   ↓
2. Frontend calls: initiateInstagramConnection() (server fn)
   ↓
3. Backend generates OAuth URL with state token
   ↓
4. Frontend redirects: window.location.href = oauth_url
   ↓
5. User logs in & authorizes at Meta
   ↓
6. Meta redirects: /api/instagram/callback?code=...&state=...
   ↓
7. Backend exchanges code for access token
   ↓
8. Backend fetches: Facebook Pages → Instagram Accounts
   ↓
9. Backend saves to: social_channel_connections table
   ↓
10. Backend redirects: /marketing/connected-channels?instagram=connected
   ↓
11. Frontend detects URL param & refreshes channel status
   ↓
12. Frontend displays: Instagram Connected, @handle, Last Sync
```

## Database Schema

```sql
-- NEW TABLE: social_channel_connections
CREATE TABLE public.social_channel_connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,          -- Multi-tenant isolation
  channel channel_type NOT NULL,    -- 'instagram', 'facebook', etc.
  access_token TEXT NOT NULL,       -- OAuth token (stored securely)
  refresh_token TEXT,               -- Optional refresh token
  token_expires_at TIMESTAMPTZ,     -- Token expiry
  channel_id TEXT NOT NULL,         -- Instagram Business Account ID
  channel_name TEXT,                -- Display name
  handle TEXT,                      -- @username
  profile_picture_url TEXT,         -- Avatar URL
  status channel_status NOT NULL,   -- 'connected', 'disconnected', 'error'
  last_sync TIMESTAMPTZ,            -- Last sync time
  error_message TEXT,               -- Error details if status='error'
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(tenant_id, channel, channel_id)
);

-- RLS Policy: Tenants only see their own connections
ALTER TABLE social_channel_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY social_channel_connections_tenant
  ON social_channel_connections FOR ALL TO authenticated
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());
```

## Key Features

✅ **OAuth 2.0 Flow** — Secure authorization with state token CSRF protection
✅ **Multi-Tenant** — Each tenant isolated by tenant_id
✅ **Row-Level Security** — RLS policies enforce data isolation at database level
✅ **Error Handling** — User-friendly error messages for all failure scenarios
✅ **Loading States** — Spinner feedback during OAuth redirect
✅ **Auto-Refresh** — Channels update automatically on OAuth return
✅ **Disconnect** — Revoke access and remove stored tokens
✅ **Status Tracking** — Display connection status, handle, profile picture, last sync

## Testing the Implementation

### Quick Test (Local)

```bash
# 1. Start services (both point at the hosted Supabase project via .env)
cd apps/api && python main.py &
cd apps/web && npm run dev &

# 2. Open browser
http://localhost:3000/_authed/marketing/connected-channels

# 3. Look for:
# - 4 channel cards (Instagram, Facebook, Google, WhatsApp)
# - Instagram card has "Connect Instagram" button
# - All showing "Not connected" status

# 4. Click "Connect Instagram"
# - Should redirect to https://www.facebook.com/v20.0/dialog/oauth?...
# - Log in with Meta account
# - Click "Continue"
# - Should redirect back to Connected Channels page

# 5. Verify:
# - Instagram card shows "Connected" badge
# - @username displays
# - "Sync", "View", "Disconnect" buttons appear
# - Status persists on page refresh
```

### Database Verification

```sql
-- From supabase studio or psql
SELECT * FROM social_channel_connections;

-- Should show one row with:
-- tenant_id: your tenant
-- channel: 'instagram'
-- handle: '@your_username'
-- status: 'connected'
```

## Troubleshooting

**"Cannot POST /api/instagram/connect"**
- FastAPI server not running
- Start: `cd apps/api && python main.py`

**"Invalid state parameter"**
- State token expired
- Clear cookies and retry

**"No Instagram business account found"**
- Instagram account not linked to Facebook Page
- Or account is personal (not Professional)

**"Redirect URI mismatch"**
- Exact match required: `http://localhost:8000/api/instagram/callback`
- Check Meta app OAuth redirect settings

**"TypeError: Cannot read property 'oauth_url'"**
- Backend returned error instead of success
- Check backend logs for error details

## Next Steps

1. **Get Meta Credentials** (10 min)
   - Create app at developers.facebook.com
   - Copy APP_ID and APP_SECRET
   - Add to .env

2. **Run Database Migration** (5 min)
   - `supabase db push`, or apply it via the SQL Editor

3. **Start Services** (2 min)
   - Backend, frontend

4. **Test OAuth Flow** (10 min)
   - Click Connect
   - Authorize
   - Verify connection

5. **Deploy to Production** (Later)
   - Update META_REDIRECT_URI to production domain
   - Use HTTPS
   - Set up Redis for state token storage
   - Implement token refresh logic

## Support Resources

- Meta Instagram Graph API: https://developers.facebook.com/docs/instagram-graph-api
- OAuth 2.0 Spec: https://tools.ietf.org/html/rfc6749
- Supabase RLS: https://supabase.com/docs/guides/auth/row-level-security
- FastAPI: https://fastapi.tiangolo.com/
- Full Setup Guide: `docs/INSTAGRAM_OAUTH_SETUP.md`

---

**Implementation Date**: 2026-06-10
**Status**: Ready for testing
**Completed**: All files created and modified
**Next**: Configure Meta credentials and test
