# Instagram OAuth Integration Guide

Complete implementation of Instagram connection flow using Meta Graph API. This guide covers setup, deployment, and usage.

## Overview

The Instagram connection flow allows dealership users to:
1. Click "Connect Instagram" button
2. Authorize the app via Meta OAuth
3. Auto-fetch Instagram business account details
4. Store connection securely in database
5. Display connected status with account information
6. Disconnect and reconnect as needed

## Architecture

### Backend (FastAPI)
- **Router**: `apps/api/routers/instagram.py` — OAuth endpoints
- **Service**: `apps/api/services/instagram.py` — Meta Graph API interactions
- **Models**: `apps/api/models/instagram.py` — Pydantic validation schemas
- **Database**: `supabase/migrations/0015_social_channels.sql` — Connection storage

### Frontend (React + TanStack)
- **Server Functions**: `apps/web/src/lib/marketing.ts`
  - `initiateInstagramConnection()` — Starts OAuth flow
  - `disconnectInstagram()` — Revokes connection
  - `getChannelStatus()` — Fetches current status
- **Component**: `apps/web/src/routes/_authed/marketing.connected-channels.tsx`

### Database
- Table: `social_channel_connections`
- Stores: access_token, channel_id, username, profile picture, status
- RLS: Multi-tenant isolation via `tenant_id`

## Step-by-Step Setup

### 1. Create Meta App

1. Go to [Meta Developers Dashboard](https://developers.facebook.com/apps)
2. Create a new app (or use existing)
3. Choose app type: **Consumer**
4. Add **Instagram Graph API** product
5. Navigate to **Settings → Basic**
   - Copy **App ID** → `META_APP_ID`
   - Copy **App Secret** → `META_APP_SECRET` (keep secure!)
6. Navigate to **Settings → Basic → App Roles**
   - Add your Facebook account as **Admin**

### 2. Configure OAuth Redirect URI

1. In Meta app dashboard, go to **Instagram Basic Display** settings
2. Under **Valid OAuth Redirect URIs**, add:
   ```
   http://localhost:8000/api/instagram/callback
   ```
   (For production: `https://your-domain.com/api/instagram/callback`)

3. Also configure in **Instagram Graph API** settings if needed

### 3. Link Instagram Business Account

1. Ensure you have:
   - Facebook Page (Business)
   - Instagram Professional Account linked to that Facebook Page
   - Both accounts owned by the same Facebook account

2. The OAuth flow will automatically fetch:
   - Facebook Pages you admin
   - Instagram Business Accounts linked to those pages
   - First account is used (or enhance to support multiple)

### 4. Environment Variables

#### Backend (`apps/api/.env`)
```bash
# Meta / Instagram OAuth
META_APP_ID=your_app_id_from_meta_dashboard
META_APP_SECRET=your_app_secret_from_meta_dashboard
META_REDIRECT_URI=http://localhost:8000/api/instagram/callback
META_API_VERSION=v20.0

# Supabase (example for local dev)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=your_service_role_key
```

#### Frontend (`apps/web/.env.local`)
```bash
# No additional vars needed — frontend calls backend endpoints
```

### 5. Database Migration

Run the migration to create the `social_channel_connections` table:

```bash
cd supabase
supabase migration up
# or
supabase db reset  # (includes all migrations)
```

This creates:
- `social_channel_connections` table with RLS policies
- Enum types: `channel_type`, `channel_status`
- Indexes on `(tenant_id, channel)` and `(tenant_id, status)`

### 6. Backend Dependencies

Already included in `apps/api/requirements.txt`:
- `fastapi>=0.115.0`
- `httpx>=0.27.0` — for async HTTP requests to Meta API
- `supabase>=2.10.0` — for database access
- `pydantic>=2.9.0` — for validation

No new packages needed!

### 7. Start Services

```bash
# Terminal 1: Start Supabase (if using local dev)
cd supabase
supabase start

# Terminal 2: Start FastAPI backend
cd apps/api
python main.py
# or: uvicorn main:app --reload

# Terminal 3: Start React frontend
cd apps/web
npm run dev
```

## API Endpoints

### `POST /api/instagram/connect`

Initiate Instagram OAuth flow.

**Request:**
```json
{
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "user_id": "user-id-from-jwt"
}
```

**Response:**
```json
{
  "oauth_url": "https://www.facebook.com/v20.0/dialog/oauth?...",
  "state": "random_state_token"
}
```

**Frontend Usage:**
```typescript
const { oauth_url } = await initiateInstagramConnection()
window.location.href = oauth_url  // Redirect to Meta
```

### `GET /api/instagram/callback`

OAuth callback from Meta (automatic redirect).

**Query Parameters:**
- `code` — Authorization code
- `state` — State token (CSRF protection)
- `error` — Error code if denied

**Behavior:**
1. Validates state token
2. Exchanges code for access token
3. Fetches Facebook Pages
4. Fetches Instagram Business Account from first page
5. Saves connection to `social_channel_connections`
6. Redirects to frontend: `/marketing/connected-channels?instagram=connected`

### `POST /api/instagram/disconnect`

Disconnect Instagram channel.

**Request:**
```json
{
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "channel_id": "instagram-business-account-id"
}
```

**Response:**
```json
{
  "status": "disconnected",
  "message": "Instagram channel successfully disconnected"
}
```

### `GET /api/instagram/status`

Get current Instagram connection status.

**Query Parameters:**
- `tenant_id` — Tenant UUID

**Response:**
```json
{
  "channel": "instagram",
  "status": "connected",
  "handle": "@nissan_marketing_group",
  "channel_id": "17841408046456890",
  "channel_name": "Nissan Marketing Group",
  "profile_picture_url": "https://...",
  "last_sync": "2026-06-10T12:30:00Z"
}
```

## Frontend Components

### Connected Channels Page

**Route**: `/_authed/marketing/connected-channels`

**Loader**:
```typescript
loader: async () => ({ channels: await getChannelStatus() })
```

Fetches all channel statuses on page load.

**Component Features**:
- Shows summary cards (Total, Connected, Disconnected, Last Sync)
- Channel cards with:
  - Connected/Disconnected status badge
  - Account handle (e.g., `@nissan_marketing_group`)
  - Last sync timestamp
  - Action buttons:
    - **Connect** (for disconnected channels)
    - **Sync** (for connected channels)
    - **View** (for connected channels)
    - **Disconnect** (for connected channels)

**State Management**:
```typescript
const [channels, setChannels] = useState<ChannelConnection[]>(initialChannels)
const [loadingChannel, setLoadingChannel] = useState<string | null>(null)
const [error, setError] = useState<string | null>(null)
```

### Handler Functions

**`handleConnectInstagram()`**:
- Calls `initiateInstagramConnection()`
- Redirects user to Meta OAuth
- User authorizes app
- Meta redirects back to `/api/instagram/callback`
- Frontend auto-refreshes on return

**`handleDisconnectInstagram(channelId)`**:
- Shows confirmation dialog
- Calls `disconnectInstagram({ channel_id: channelId })`
- Refreshes channel status
- Updates UI

## Database Schema

### `social_channel_connections` Table

```sql
CREATE TABLE social_channel_connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,  -- Multi-tenant
  channel channel_type NOT NULL,  -- 'instagram', 'facebook', etc.
  
  -- OAuth & Auth
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  
  -- Channel Info
  channel_id TEXT NOT NULL,  -- Instagram Business Account ID
  channel_name TEXT,  -- Display name
  handle TEXT,  -- @username
  profile_picture_url TEXT,
  
  -- Status
  status channel_status NOT NULL,  -- 'connected', 'disconnected', 'error'
  last_sync TIMESTAMPTZ,
  error_message TEXT,
  
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  
  UNIQUE(tenant_id, channel, channel_id)
);
```

### Enums

```sql
CREATE TYPE channel_type AS ENUM ('instagram', 'facebook', 'google_business', 'whatsapp');
CREATE TYPE channel_status AS ENUM ('connected', 'disconnected', 'error');
```

### Row-Level Security (RLS)

```sql
ALTER TABLE social_channel_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_channel_connections_tenant
  ON social_channel_connections
  FOR ALL TO authenticated
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());
```

Ensures tenants can only see their own connections.

## Error Handling

### Frontend Errors

All async operations catch errors and display in error alert:

```typescript
{error && (
  <div className="rounded-[12px] border border-red-200 bg-red-50 p-4">
    <p className="text-[12px] font-semibold text-red-800">{error}</p>
  </div>
)}
```

### Common Issues

1. **"Invalid state parameter"** — State token expired or tampered with
   - Timeout is 10 minutes
   - Clear browser cache and retry

2. **"No Instagram business account found"** — Page not linked to Instagram
   - Verify Facebook Page has Instagram Professional account linked
   - Both must be owned by same Facebook account

3. **"OAuth error: user_denied"** — User clicked "Don't Allow"
   - Try again, ensure user has admin access to Instagram account

4. **Token expired** — Long-lived access tokens expire after ~60 days
   - Future: Implement token refresh endpoint
   - Currently: User disconnects and reconnects

## Security Considerations

### Access Token Storage

- ✅ Stored in database (Supabase PostgreSQL)
- ✅ Not sent to frontend/browser
- ✅ Only used server-side via FastAPI
- ✅ RLS ensures tenant isolation

### CSRF Protection

- ✅ State token generated per request
- ✅ State validated on callback
- ✅ State tokens stored in memory (production: use Redis)

### Future Improvements

1. **Token Refresh**: Implement auto-refresh for long-lived tokens
2. **Rate Limiting**: Limit OAuth attempts to prevent abuse
3. **Audit Logging**: Log all connection/disconnection events
4. **Token Rotation**: Periodically rotate stored tokens
5. **Encryption**: Encrypt tokens at rest (use Supabase Vault)

## Testing

### Manual Testing Checklist

- [ ] **Connect Flow**
  - [ ] Click "Connect Instagram" on Channels page
  - [ ] Redirected to Meta Login
  - [ ] Authorize application
  - [ ] Redirected back to Channels page
  - [ ] Instagram status shows "Connected"
  - [ ] Username displays correctly

- [ ] **Multi-Tenant Isolation**
  - [ ] Log in as User A (Tenant 1)
  - [ ] Connect Instagram to Tenant 1
  - [ ] Log in as User B (Tenant 2)
  - [ ] Verify User B doesn't see Tenant 1's connection

- [ ] **Disconnect Flow**
  - [ ] Click "Disconnect" on connected Instagram card
  - [ ] Confirm in modal
  - [ ] Status reverts to "Disconnected"
  - [ ] Data deleted from database

- [ ] **Error Handling**
  - [ ] Deny OAuth request → Shows error
  - [ ] No Facebook Pages → Shows error
  - [ ] Network failure → Shows error

### Database Testing

```sql
-- Check connections for a tenant
SELECT * FROM social_channel_connections
WHERE tenant_id = 'your-tenant-id'
AND channel = 'instagram';

-- Verify RLS isolation
SELECT COUNT(*) FROM social_channel_connections;  -- Should show 0 (RLS applied)
```

## Monitoring & Logging

### Backend Logs

Add logging to track OAuth flow:

```python
import logging
logger = logging.getLogger(__name__)

logger.info(f"Instagram connection initiated for tenant {tenant_id}")
logger.info(f"Exchanged code for access token")
logger.info(f"Saved connection: {channel_id}")
```

### Database Auditing

The `audit_logs` table (migration 0004) automatically tracks:
- INSERT → New connection created
- UPDATE → Connection updated
- DELETE → Connection removed

## Production Deployment

### Environment Variables

```bash
META_APP_ID=prod_app_id
META_APP_SECRET=prod_app_secret  # Use secrets manager!
META_REDIRECT_URI=https://your-domain.com/api/instagram/callback

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=prod_service_key
```

### HTTPS Required

Meta OAuth only works over HTTPS in production. Ensure:
- Frontend: HTTPS
- Backend: HTTPS
- Redirect URI matches exactly

### Session Management

Current state storage is in-memory. For production:
- Use Redis for state token storage
- Add expiry: 10 minutes
- Implement cleanup for expired states

```python
import redis
redis_client = redis.Redis(host='localhost', port=6379, db=0)
redis_client.setex(state, 600, json.dumps(state_data))  # 10 min TTL
```

### Rate Limiting

Add rate limiting on OAuth endpoints:

```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@router.post("/instagram/connect")
@limiter.limit("5/minute")
async def initiate_instagram_connection(...):
    ...
```

## Troubleshooting

### "Connection refused" on `http://localhost:8000`

- [ ] FastAPI server not running
- [ ] Start: `cd apps/api && python main.py`
- [ ] Check: `http://localhost:8000/health` should return `{"status": "ok"}`

### "Redirect URI mismatch"

- [ ] Meta app redirect URI doesn't match
- [ ] Check exact match: `http://localhost:8000/api/instagram/callback`
- [ ] For production: Use HTTPS and exact domain

### Instagram account not fetching

- [ ] Instagram account is not a Professional/Business account
- [ ] Instagram account is not linked to Facebook Page
- [ ] Try different Facebook Page (if multiple)

### Tokens expiring frequently

- [ ] Currently no refresh logic implemented
- [ ] User must disconnect and reconnect
- [ ] Future: Implement refresh token flow

## Support

For issues or questions:
1. Check logs: `apps/api/` output
2. Check database: Query `social_channel_connections`
3. Check frontend errors: Browser console
4. Review: Meta API documentation at https://developers.facebook.com/docs/instagram-graph-api
