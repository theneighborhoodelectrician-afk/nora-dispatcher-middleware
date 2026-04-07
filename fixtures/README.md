# Fixture Replay

Drop real payloads here as you collect them from GoHighLevel and Housecall Pro.

Suggested structure:

- `fixtures/ghl/availability.real.json`
- `fixtures/ghl/booking.real.json`
- `fixtures/hcp/schedule.real.json`

Replay examples:

```bash
npm run replay -- --mode availability --webhook fixtures/ghl/availability.sample.json --schedule fixtures/hcp/schedule.sample.json
npm run replay -- --mode booking --webhook fixtures/ghl/booking.sample.json --schedule fixtures/hcp/schedule.sample.json
```

This uses the exact parsing and decision logic from the middleware, but replaces live Housecall Pro calls with the saved schedule snapshot you provide.

To export a real Housecall Pro schedule snapshot once your env vars are set:

```bash
npm run hcp:export -- --start 2026-04-06T00:00:00.000Z --end 2026-04-10T00:00:00.000Z
```

That command saves:

- raw HCP pages
- normalized schedule jobs the middleware currently understands

Use the raw file to confirm the API shape and the normalized file to see whether the current adapter is mapping it correctly.
