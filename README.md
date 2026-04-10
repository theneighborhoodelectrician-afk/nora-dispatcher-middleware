# BookSmart Dispatcher Middleware

Webhook middleware for BookSmart, the AI booking assistant for The Neighborhood Electrician. This service preserves the existing Housecall Pro booking engine, adds a BookSmart chat flow around it, checks real availability, returns appointment options, and books the confirmed slot as a Housecall Pro job or estimate.

## BookSmart direction

This repo is now being evolved incrementally toward BookSmart v1.

- Housecall Pro remains the source of truth for availability and booking writes
- BookSmart asks one question at a time and starts with city qualification
- Structured config now lives in dedicated BookSmart config/types modules instead of prompt-only logic
- Typed tool wrappers sit between chat orchestration and the existing HCP-backed services
- Chat webhook deliveries now use idempotent replay protection

What is preserved in this phase:

- Existing HCP schedule reads and booking writes
- Existing slot-building and booking services
- Existing webhook/auth/storage foundations

What is new in this phase:

- `src/booksmart/` for structured service/config definitions
- `src/adapters/hcp/` for a stable HCP adapter wrapper
- `src/tools/booksmart.ts` for typed booking/chat tools
- `src/channels/blooio/normalize.ts` for inbound channel normalization
- A city-first BookSmart chat orchestration flow in [`/Users/nateanderson/Documents/The Neighborhood Dispatcher/src/services/chatbot.ts`](/Users/nateanderson/Documents/The%20Neighborhood%20Dispatcher/src/services/chatbot.ts)

Still planned:

- OpenAI Responses API orchestration
- database-backed editable operator config
- internal `/admin` operator console
- richer conversation persistence beyond chat sessions

## Admin API

The project now exposes read-only conversation analytics plus BookSmart config management endpoints for future operator-console work.

- `GET /api/admin/conversations`
  Returns recent structured conversation outcomes.
- `GET /api/admin/conversations?conversationId=...`
  Returns the full conversation bundle:
  conversation, outcome, stages, transcript messages, slot exposures, urgency hits, booking events, and handoff events.
- `GET /api/admin/booksmart-config`
  Returns the current stored BookSmart config, seeding defaults if none exists yet.
- `PUT /api/admin/booksmart-config`
  Validates and saves a full BookSmart config payload.

If `ADMIN_SECRET` is configured, send it as `x-admin-secret`.

## Admin UI

A lightweight internal console now exists at `/admin/`.

Current capabilities:

- view recent structured conversation outcomes
- inspect a full conversation record with stages, transcript, slot exposure, urgency hits, bookings, and handoffs
- load and save the full BookSmart config JSON through the authenticated admin API

This UI is intentionally thin in v1. It is a static internal surface over the admin APIs, not yet a fully modeled operator dashboard.

## Conversation Tracking

BookSmart now persists a structured conversation analytics layer for future human-reviewed optimization work.

- `conversations`
- `contacts`
- `conversation_outcomes`
- `conversation_stage_history`
- `slot_exposure_history`
- `urgency_keyword_hits`
- `conversation_messages`
- `lead_sources`
- `booking_events`
- `handoff_events`

This tracking is write-only operational data in v1. It does not automatically retrain prompts, change routing, or modify operator settings.

Assumptions in the current implementation:

- `lead_source` is normalized from inbound chat payload values and falls back to `unknown`
- `photo_received` is inferred only when the inbound payload includes image attachments or media URLs
- `abandonment_stage` is stored as the current incomplete stage for unfinished conversations, but true `abandoned` stage transitions are not inferred synchronously during an active chat session

## What is included

- Vercel-friendly TypeScript API handlers
- Availability webhook: `POST /api/webhooks/availability`
- Booking webhook: `POST /api/webhooks/booking`
- Chat webhook: `POST /api/webhooks/chat`
- Health check: `GET /api/health`
- Health response includes storage mode and whether the Postgres schema is ready
- Health response also includes whether storage auto-init is enabled
- First-pass service classification and duration estimates
- Technician skill routing for Steve, Brandon, Dave, Lou, and estimate-only Nate
- Macomb and Oakland county zip filtering
- Zip-to-zip drive-time estimation using built-in centroids plus county fallbacks
- Slot ranking by best-fit technician, travel, complexity, and same-day feasibility
- Emergency detection with soft handoff escalation payloads
- Final-lock recheck before booking to reduce double-booking risk
- Housecall Pro adapter with retry and pagination scaffolding
- In-memory idempotency protection for duplicate webhook deliveries
- GHL-ready presentation payloads with reply text and exactly three option labels
- Chat-ready conversation state for text-first booking flows

## Current business rules

- Default offered slots: top 3
- Response statuses:
  - `slots_available`
  - `human_escalation_required`
  - `booked`
  - `slot_unavailable`
- Business hours: 9 AM to 6 PM
- Same-day booking: only when a clean slot exists
- Estimates instead of jobs for:
  - panel upgrades
  - EV chargers
  - large renovations
- Senior-only complex work:
  - Steve
  - Brandon
  - Nate for estimates only
- Dave handles:
  - troubleshooting
  - fixtures
  - new plugs
  - recessed lighting
  - less complicated larger jobs
- Lou handles:
  - EV chargers
  - small service changes
  - rough wiring
  - troubleshooting

## Project structure

```text
api/
  health.ts
  webhooks/
    availability.ts
    booking.ts
    chat.ts
src/
  adapters/
    hcp/
  booksmart/
  channels/
    blooio/
  config.ts
  domain/
  integrations/
  lib/
  schemas/
  tools/
  services/
tests/
```

## Environment variables

Copy `.env.example` to `.env.local` for local development.

```bash
NODE_ENV=development
DEFAULT_TIMEZONE=America/Detroit
OPENING_HOUR=9
CLOSING_HOUR=18
DEFAULT_SLOT_COUNT=3
MAX_LOOKAHEAD_DAYS=7
MIN_LEAD_HOURS=2
BUFFER_MINUTES=30
HCP_API_BASE_URL=https://api.housecallpro.com
HCP_API_TOKEN=
HCP_COMPANY_ID=
HCP_CUSTOMER_PATH=/customers
HCP_EMPLOYEE_PATH=/public/v1/employees
HCP_SCHEDULE_PATH=/jobs
HCP_CREATE_JOB_PATH=/jobs
HCP_CREATE_ESTIMATE_PATH=/public/v1/estimates
GHL_WEBHOOK_SECRET=
POSTGRES_URL=
AUTO_INIT_STORAGE=true
```

## Local development

```bash
npm install
npm run dev
```

For local payload validation without live API calls:

```bash
npm run replay -- --mode availability --webhook fixtures/ghl/availability.sample.json --schedule fixtures/hcp/schedule.sample.json
npm run replay -- --mode booking --webhook fixtures/ghl/booking.sample.json --schedule fixtures/hcp/schedule.sample.json
```

For live Housecall Pro schedule export once credentials are configured:

```bash
npm run hcp:export -- --start 2026-04-06T00:00:00.000Z --end 2026-04-10T00:00:00.000Z
```

For a deliberately gated live Housecall Pro booking write test:

```bash
npm run hcp:live-booking-test -- --webhook fixtures/ghl/booking.real.json --confirm CREATE_LIVE_HCP_BOOKING
```

If `POSTGRES_URL` is set, the app will use Postgres for idempotency and webhook audit logs. If it is not set, it falls back to in-memory storage.
If `AUTO_INIT_STORAGE=true`, the app will create the storage tables automatically on health checks and webhook traffic when Postgres is configured.

To initialize the Postgres tables, run the SQL in [`/Users/nateanderson/Documents/The Neighborhood Dispatcher/sql/storage.sql`]( /Users/nateanderson/Documents/The Neighborhood Dispatcher/sql/storage.sql ).

You can also bootstrap the schema from the app with:

```bash
npm run db:init
```

Before deploying, run:

```bash
npm run deploy:check
```

## Deployment checklist

1. Configure these env vars in the host:
   - `HCP_API_TOKEN`
   - `HCP_CUSTOMER_PATH=/customers`
   - `HCP_SCHEDULE_PATH=/jobs`
   - `HCP_CREATE_JOB_PATH=/jobs`
   - `HCP_CREATE_ESTIMATE_PATH=/public/v1/estimates`
   - `GHL_WEBHOOK_SECRET`
   - `POSTGRES_URL`
2. Run `npm run deploy:check` locally against the same env values.
3. If using Postgres, run `npm run db:init` or let `AUTO_INIT_STORAGE=true` bootstrap the schema.
4. Deploy and open `GET /api/health`.
5. Confirm the health response shows:
   - `success: true`
   - `storage.mode: "postgres"` for production
6. Point GoHighLevel webhooks at:
   - `/api/webhooks/availability`
   - `/api/webhooks/booking`
   - `/api/webhooks/chat` for Blooio or another text channel
7. Send a test availability webhook first before enabling live booking traffic.

## Chatbot webhook

The chat route is designed for a text channel such as Blooio. It accepts a lightweight message payload,
stores the conversation state, asks for missing details one step at a time, starts by qualifying the city,
then gathers service type, address, contact details, and morning or afternoon preference before checking
availability through the same HCP-backed services used elsewhere in the middleware.

Example payload:

```json
{
  "sessionId": "chat-123",
  "text": "I need help installing recessed lights",
  "contact": {
    "phone": "586-555-0100"
  }
}
```

Example response:

```json
{
  "success": true,
  "sessionId": "chat-123",
  "replyText": "What city is the project in?",
  "stage": "collect_city"
}
```

You can protect this route with either:

- `x-nora-chat-secret`
- `x-blooio-secret`
- `x-nora-signature`

using `BLOOIO_WEBHOOK_SECRET` as the shared secret.

## GoHighLevel webhook auth

The API accepts either of these auth methods:

- `x-nora-signature`
  - HMAC SHA-256 of the raw JSON request body using `GHL_WEBHOOK_SECRET`
- `x-nora-secret`
  - direct shared-secret header whose value matches `GHL_WEBHOOK_SECRET`

For GoHighLevel, the easiest setup is usually a custom header:

```text
x-nora-secret: your-ghl-webhook-secret
```

That avoids needing to generate an HMAC signature inside the workflow builder.

## Example availability payload

```json
{
  "webhookId": "ghl-availability-001",
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "586-555-0100",
  "email": "jane@example.com",
  "address": "123 Main St, Sterling Heights, MI",
  "zipCode": "48313",
  "requestedService": "Install recessed lights in living room",
  "notes": "Customer prefers afternoons",
  "sameDayRequested": false
}
```

## Example availability response

```json
{
  "success": true,
  "status": "slots_available",
  "message": "Here are the three best options based on technician skill, contiguous job time, and route efficiency.",
  "service": {
    "category": "recessed-lighting",
    "title": "Recessed lighting",
    "durationMinutes": 240,
    "requiredSkills": ["recessed-lighting", "residential"],
    "preferredSkills": [],
    "target": "job",
    "complexityScore": 6
  },
  "slots": [
    {
      "technician": "Dave",
      "label": "Tomorrow at 1:00 PM",
      "start": "2026-04-04T17:00:00.000Z",
      "end": "2026-04-04T21:00:00.000Z",
      "score": 13,
      "reason": "Dave is qualified for recessed lighting with an estimated 20-minute drive in macomb county coverage.",
      "driveMinutes": 20,
      "serviceCategory": "recessed-lighting",
      "bookingTarget": "job"
    }
  ],
  "presentation": {
    "replyText": "I have Tomorrow at 1:00 PM, Tuesday at 9:00 AM, or Wednesday at 11:00 AM. Do any of those work for you?",
    "followUpPrompt": "Ask the customer which of the three options works best.",
    "options": [
      {
        "label": "Tomorrow at 1:00 PM",
        "start": "2026-04-04T17:00:00.000Z",
        "end": "2026-04-04T21:00:00.000Z",
        "technician": "Dave",
        "bookingTarget": "job"
      }
    ]
  }
}
```

## Example soft handoff response

```json
{
  "success": false,
  "status": "human_escalation_required",
  "message": "This sounds urgent, so Nora should hand it to dispatch right away instead of offering online booking.",
  "escalationReason": "emergency_keyword_detected",
  "service": {
    "category": "residential-troubleshooting",
    "title": "Residential troubleshooting",
    "durationMinutes": 120,
    "requiredSkills": ["troubleshooting"],
    "preferredSkills": ["senior"],
    "target": "job",
    "complexityScore": 7,
    "escalationKeywords": ["fire", "smoke", "sparks"]
  },
  "slots": [],
  "presentation": {
    "replyText": "I'm having dispatch review this right now because it sounds urgent. They will call you in about 5 minutes.",
    "followUpPrompt": "Tell the customer dispatch will review the schedule and follow up directly."
  }
}
```

## Example booking payload

```json
{
  "webhookId": "ghl-booking-001",
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "586-555-0100",
  "email": "jane@example.com",
  "address": "123 Main St, Sterling Heights, MI",
  "zipCode": "48313",
  "requestedService": "Install recessed lights in living room",
  "notes": "Customer prefers afternoons",
  "selectedSlot": {
    "technician": "Dave",
    "start": "2026-04-04T17:00:00.000Z",
    "end": "2026-04-04T21:00:00.000Z",
    "bookingTarget": "job"
  }
}
```

## Important implementation notes

- Housecall Pro endpoint defaults are configurable because the live public docs are partially JS-rendered and may vary by account or auth setup.
- If `HCP_API_TOKEN` is not set, the app runs in mock mode for Housecall Pro writes and schedule reads.
- Idempotency is in-memory today. For production durability across serverless instances, replace this with Postgres-backed storage.
- The app now supports Postgres-backed idempotency and webhook event logging when `POSTGRES_URL` is configured.
- The HCP client is prepared for cursor or page-based pagination and retries `429/5xx` responses with backoff, but the exact live response shape still needs to be confirmed against your account.
- The current scheduling logic uses a first-pass travel model and service-duration catalog. Those should be refined using your real dispatch data after a few weeks of bookings.

## Recommended next steps

1. Confirm the exact Housecall Pro auth flow and endpoint paths for your account.
2. Capture real GoHighLevel webhook payloads so we can map any custom fields precisely.
3. Move idempotency and webhook logging into Postgres before production launch.
4. Add a private admin endpoint or dashboard for replaying failed bookings and reviewing suggested slots.
