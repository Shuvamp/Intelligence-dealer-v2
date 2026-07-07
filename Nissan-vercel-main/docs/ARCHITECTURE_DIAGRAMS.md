# Instagram OAuth - Architecture & Data Flow Diagrams

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                               │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ React App (TanStack)                                           │  │
│  │ - Connected Channels Page                                      │  │
│  │ - [Connect Instagram] Button                                   │  │
│  │ - Shows: Username, Profile Pic, Status                        │  │
│  │ - Actions: Connect, Disconnect, Sync, View                    │  │
│  └────────────────┬────────────────────────────────────┬─────────┘  │
│                   │                                    │              │
│        Server Fn  │ GET: getChannelStatus()            │ POST        │
│        Calls      │ POST: initiateInstagramConnection()│ Calls       │
│                   │ POST: disconnectInstagram()         │             │
│                   ↓                                    ↓              │
└────────────────────────────────────────────────────────────────────────┘
                     │                              ▲
                     │                              │
        HTTP (localhost:3000)       HTTP (localhost:8000)
                     │                              │
                     ↓                              │
┌──────────────────────────────────────────────────────────────────────┐
│                        FASTAPI BACKEND                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Instagram Router (/routers/instagram.py)                       │  │
│  │                                                                │  │
│  │ POST   /api/instagram/connect                                 │  │
│  │   └─→ Generate OAuth URL with state token                     │  │
│  │                                                                │  │
│  │ GET    /api/instagram/callback                                │  │
│  │   └─→ Validate state → Exchange code → Fetch account         │  │
│  │       → Save to database                                      │  │
│  │                                                                │  │
│  │ POST   /api/instagram/disconnect                              │  │
│  │   └─→ Delete connection from database                         │  │
│  │                                                                │  │
│  │ GET    /api/instagram/status                                  │  │
│  │   └─→ Query database → Return connection info                │  │
│  └────────────────┬────────────────────────────────────┬────────┘  │
│                   │                                    │             │
│  Instagram Service │ HTTPx Async Calls                 │             │
│  Layer             ↓                                    ↓             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Instagram Service (/services/instagram.py)                    │  │
│  │                                                                │  │
│  │ • get_oauth_url()                                             │  │
│  │ • exchange_code_for_token()                                   │  │
│  │ • get_facebook_pages()                                        │  │
│  │ • get_instagram_business_account()                            │  │
│  │ • verify_token_validity()                                     │  │
│  │ • get_token_expiry()                                          │  │
│  └────────────┬─────────────────────────────────────────────────┘  │
│               │                                                      │
│               │ Makes HTTP requests to:                             │
│               │ • https://www.facebook.com/v20.0/dialog/oauth      │
│               │ • https://graph.instagram.com/v20.0/...            │
│               │                                                      │
└───────────────┼──────────────────────────────────────────────────────┘
                │
                │ HTTPS (OAuth & Graph API)
                │
                ↓
    ┌───────────────────────────────────────────┐
    │   META SERVERS                            │
    │ • Facebook OAuth                          │
    │ • Instagram Graph API                     │
    │ (User login, token exchange, data fetch)  │
    └───────────────────────────────────────────┘


                                │ Supabase PostgreSQL
                                │ (JWT authenticated)
                                ↓
                ┌──────────────────────────────────────────┐
                │      DATABASE (Supabase)                 │
                │                                          │
                │  social_channel_connections table        │
                │  ┌───────────────────────────────────┐  │
                │  │ id                                 │  │
                │  │ tenant_id (multi-tenant)           │  │
                │  │ channel ('instagram')               │  │
                │  │ access_token (secured)             │  │
                │  │ refresh_token                      │  │
                │  │ channel_id                         │  │
                │  │ handle ('@username')               │  │
                │  │ profile_picture_url                │  │
                │  │ status ('connected'|'disconnected')│  │
                │  │ last_sync                          │  │
                │  │ created_at, updated_at             │  │
                │  └───────────────────────────────────┘  │
                │                                          │
                │  RLS Policies: Tenant isolation         │
                └──────────────────────────────────────────┘
```

## OAuth Flow Sequence Diagram

```
USER                FRONTEND              BACKEND             META SERVER          DATABASE
│                    │                      │                    │                   │
├─ Click "Connect"──→│                      │                    │                   │
│  Instagram         │                      │                    │                   │
│                    ├─ POST /connect ─────→│                    │                   │
│                    │                      ├─ Generate state    │                   │
│                    │                      ├─ Create OAuth URL  │                   │
│                    │ {oauth_url, state}   │                    │                   │
│                    │←─────────────────────┤                    │                   │
│                    │                      │                    │                   │
│                    ├─ Redirect ──────────────────────────────→│                   │
│                    │ to oauth_url         │                    │                   │
│                    │                      │                    │                   │
├─ Log in & ─────────────────────────────────────────────────→│                   │
│  authorize in      │                      │                    │                   │
│  Meta browser      │                      │                    │                   │
│                    │                      │                    │                   │
│ Meta redirects    │                      │                    │                   │
│ with code─────────────────────────────────────────────────→│                   │
│                    │ GET /callback?code   │                    │                   │
│                    │ &state               │                    │                   │
│                    │                      ├─ Validate state    │                   │
│                    │                      ├─ Exchange code ────→│                   │
│                    │                      │                    │ Return access_token
│                    │                      │←─ access_token ────┤                   │
│                    │                      │                    │                   │
│                    │                      ├─ Fetch Pages ─────→│                   │
│                    │                      │ & Instagram Acc    │                   │
│                    │                      │←─ Account data ────┤                   │
│                    │                      │                    │                   │
│                    │                      ├─ Save connection ──────────────────────→│
│                    │                      │ (insert into table) │                   │
│                    │                      │                    │←─ Confirm insert─┤
│                    │                      │                    │                   │
│ Meta redirects    │                      │                    │                   │
│ to callback ──────────────────────────────────────────────┐  │                   │
│ URL               │                      │               │  │                   │
│                   │←─ Redirect with ─────┤               │  │                   │
│                   │   instagram=connected │               │  │                   │
│                   │                      │               │  │                   │
│                   ├─ Auto-detect ────────┤               │  │                   │
│                   │ URL param            │               │  │                   │
│                   │                      │               │  │                   │
│                   ├─ GET /status ───────→│               │  │                   │
│                   │                      ├─ Query DB ────────────────────────────→│
│                   │                      │               │  │  Return connection│
│                   │                      │←─ Connection info ────────────────────┤
│                   │{status, handle,      │               │  │                   │
│  Channels page ←──┤ profile_pic, etc.}   │               │  │                   │
│  Updated ✓        │                      │               │  │                   │
│                   │                      │               │  │                   │
│ Shows:            │                      │               │  │                   │
│ • Connected badge │                      │               │  │                   │
│ • @username       │                      │               │  │                   │
│ • Profile picture │                      │               │  │                   │
│ • Last sync       │                      │               │  │                   │
│ • Disconnect btn  │                      │               │  │                   │
│                   │                      │               │  │                   │
├─ Click Disconnect│                      │               │  │                   │
│ with confirm      ├─ POST /disconnect ──→│               │  │                   │
│                   │                      ├─ Delete row ──────────────────────────→│
│                   │                      │               │  │  Row deleted ✓   │
│                   │                      │←─ Confirm ────┤   │                   │
│                   │{status: disconnected}│               │  │                   │
│                   │                      │               │  │                   │
│                   ├─ GET /status ───────→│               │  │                   │
│                   │                      ├─ Query DB ────────────────────────────→│
│                   │                      │               │  │  No row found    │
│                   │{status: disconnected}│               │  │                   │
│  Channels page ←──┤                      │               │  │                   │
│  Reverted ✓       │                      │               │  │                   │
```

## Component Hierarchy

```
Root
│
├─ __root.tsx (Root shell)
│  └─ Session context
│     └─ Router
│        └─ _authed.tsx (Session guard)
│           └─ /marketing/connected-channels (THIS PAGE)
│              │
│              ├─ Header
│              │  └─ "Connected Channels"
│              │
│              ├─ Error Alert (conditional)
│              │  └─ Display errors from OAuth/disconnect
│              │
│              ├─ Summary Stats
│              │  ├─ Total Channels
│              │  ├─ Connected Count
│              │  ├─ Disconnected Count
│              │  └─ Last Sync
│              │
│              ├─ Channel Cards (mapped)
│              │  ├─ Instagram Card
│              │  │  ├─ Icon (IG badge)
│              │  │  ├─ Title & Status Badge
│              │  │  ├─ Description
│              │  │  ├─ Handle (if connected)
│              │  │  ├─ Last Sync (if connected)
│              │  │  └─ Action Buttons
│              │  │     ├─ Connect button (if disconnected)
│              │  │     ├─ Sync button (if connected)
│              │  │     ├─ View button (if connected)
│              │  │     └─ Disconnect button (if connected)
│              │  │
│              │  ├─ Facebook Card (similar)
│              │  ├─ Google Business Card (similar)
│              │  └─ WhatsApp Card (similar)
│              │
│              └─ Info Box
│                 └─ OAuth Integration Help Text
```

## State Management

```
ConnectedChannels Component State

┌─────────────────────────────────────────────────────┐
│ useState<ChannelConnection[]>(initialChannels)      │
│ ┌───────────────────────────────────────────────┐   │
│ │ channels = [                                  │   │
│ │   {                                           │   │
│ │     channel: 'instagram',                     │   │
│ │     status: 'connected' | 'disconnected',     │   │
│ │     handle: '@nissan_marketing_group',        │   │
│ │     last_sync: '2026-06-10T12:30:00Z'        │   │
│ │   },                                          │   │
│ │   ...                                         │   │
│ │ ]                                             │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ useState<string | null>(null)                       │
│ loadingChannel = 'instagram' | null                 │
│ (Tracks which channel is loading during OAuth)     │
│                                                     │
│ useState<string | null>(null)                       │
│ error = 'Error message' | null                      │
│ (Displays error alerts to user)                     │
│                                                     │
│ useEffect(() => {                                   │
│   // Check for ?instagram=connected in URL params   │
│   // Auto-refresh channels on OAuth callback        │
│ }, [])                                              │
└─────────────────────────────────────────────────────┘
```

## Database Schema (Visual)

```
TABLE: social_channel_connections
┌─────────────┬───────────────────────────────────────┐
│ Column      │ Type                                  │
├─────────────┼───────────────────────────────────────┤
│ id          │ UUID PRIMARY KEY                      │
│ tenant_id   │ UUID NOT NULL (FK → tenants)          │
│ channel     │ channel_type ENUM                     │
│             │ ('instagram', 'facebook', ...)        │
├─────────────┼───────────────────────────────────────┤
│ access_token│ TEXT NOT NULL (OAuth token)           │
│ refresh_token│ TEXT (optional refresh)               │
│ token_expires_at│ TIMESTAMPTZ                        │
├─────────────┼───────────────────────────────────────┤
│ channel_id  │ TEXT NOT NULL                         │
│ channel_name│ TEXT (Display name)                   │
│ handle      │ TEXT ('@username')                    │
│ profile_pic │ TEXT (URL)                            │
├─────────────┼───────────────────────────────────────┤
│ status      │ channel_status ENUM                   │
│             │ ('connected', 'disconnected', 'error')│
│ last_sync   │ TIMESTAMPTZ                           │
│ error_msg   │ TEXT                                  │
├─────────────┼───────────────────────────────────────┤
│ created_at  │ TIMESTAMPTZ DEFAULT now()             │
│ updated_at  │ TIMESTAMPTZ DEFAULT now()             │
└─────────────┴───────────────────────────────────────┘

INDEXES:
• (tenant_id, channel) — Fast lookups by tenant + channel
• (tenant_id, status)  — Fast status queries

CONSTRAINTS:
• UNIQUE(tenant_id, channel, channel_id)
• FOREIGN KEY (tenant_id) → tenants.id ON DELETE CASCADE

RLS POLICY:
• Tenants only see rows where: tenant_id = auth.user_tenant_id()
```

## Environment Configuration

```
Backend (.env)
┌─────────────────────────────────────────────────────┐
│ SUPABASE_URL=http://127.0.0.1:54321               │
│ SUPABASE_SERVICE_KEY=...                           │
│                                                   │
│ META_APP_ID=your_app_id_from_dashboard            │
│ META_APP_SECRET=your_app_secret                   │
│ META_REDIRECT_URI=http://localhost:8000/...       │
│ META_API_VERSION=v20.0                            │
└─────────────────────────────────────────────────────┘

Frontend (.env.local)
┌─────────────────────────────────────────────────────┐
│ # No Meta-specific vars needed                     │
│ # Frontend calls backend endpoints                 │
│ VITE_SUPABASE_URL=...                              │
│ VITE_SUPABASE_ANON_KEY=...                         │
└─────────────────────────────────────────────────────┘
```

## Error Flow

```
User Action
    ↓
Try-Catch Block
    ↓
┌─────────────────────┴──────────────────────────┐
│                                                │
Error?                                      No Error
│                                                │
├─ Extract message                          ├─ Continue
├─ Set error state                          ├─ Update channels
├─ Display error alert                      ├─ Update UI
│  ┌─────────────────────────────────┐     └─ Show success
│  │ ┌──────────────────────────────┐│
│  │ │ Error: [message]             ││
│  │ └──────────────────────────────┘│
│  └─────────────────────────────────┘
└─ Clear loading state
```

## File Dependencies

```
Connected Channels Component
    ↓
    ├─ imports from 'lib/marketing'
    │  ├─ getChannelStatus (server fn)
    │  ├─ initiateInstagramConnection (server fn)
    │  ├─ disconnectInstagram (server fn)
    │  └─ lib/types.ts
    │     └─ ChannelConnection interface
    │
    ├─ imports from 'lucide-react'
    │  └─ Icons (CheckCircle2, XCircle, etc.)
    │
    └─ uses '@tanstack/react-router'
       ├─ createFileRoute
       ├─ useLoaderData
       └─ Route definition
```

## Deployment Architecture (Production)

```
┌──────────────────────┐
│   User's Browser     │ HTTPS
│   (https://app)      │
└──────────┬───────────┘
           │
      HTTPS│
           ↓
┌──────────────────────────────────────────┐
│   React App (Vercel/CDN)                 │
│   - Connected Channels Page              │
│   - OAuth handlers                       │
│   - Error handling                       │
└──────────┬───────────────────────────────┘
           │
      HTTPS│
           ↓
┌──────────────────────────────────────────┐
│   FastAPI Backend (AWS/Railway/etc)      │
│   - Instagram OAuth endpoints            │
│   - Meta API integration                 │
│   - JWT validation                       │
│   - RLS enforcement                      │
└──────────┬───────────────────────────────┘
           │
      HTTPS│ (Service key auth)
           ↓
┌──────────────────────────────────────────┐
│   Supabase (Cloud/Self-hosted)           │
│   - PostgreSQL database                  │
│   - Row-level security                   │
│   - JWT verification                     │
│   - Audit logging                        │
└──────────┬───────────────────────────────┘
           │
           ├─ External: Meta Graph API (HTTPS)
           └─ External: Analytics/Monitoring
```

---

This visual guide helps understand:
- System components and interactions
- OAuth flow sequence
- Component hierarchy
- State management
- Database schema
- Error handling
- Production deployment
