# Nora Dispatcher Middleware

Webhook middleware for Nora, the AI booking bot for The Neighborhood Electrician. This service receives booking requests from GoHighLevel, checks Housecall Pro availability, applies routing and technician-skill rules, returns the three best appointment options, and then books the confirmed slot as a Housecall Pro job or estimate.

## What is included

- Vercel-friendly TypeScript API handlers
- Availability webhook: `POST /api/webhooks/availability`
- Booking webhook: `POST /api/webhooks/booking`
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
src/
  config.ts
  domain/
  integrations/
  lib/
  schemas/
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
7. Send a test availability webhook first before enabling live booking traffic.

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
