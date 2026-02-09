# Family Coordination Assistant (MVP)

This service is a "coordination orchestrator" for a family:

- Parents text one assistant phone number.
- The assistant contacts the family's existing people (sitters, coaches, clinics) via SMS/email.
- It collects replies, summarizes options, and asks the parent for a simple choice (like `1/2/3`).

## What Runs Where

- **API**: Receives webhooks (Twilio inbound SMS), runs the orchestration logic, and sends outbound messages.
- **Worker**: Runs background jobs (timeouts, next-day retries, retention cleanup).
- **Postgres**: Stores tasks + message history so the system is reliable even if processes restart.

## Local Development

1. Start Postgres (Terminal):

```bash
pnpm db:up
```

2. Set env vars:

```bash
cp .env.example .env
```

3. Run migrations:

```bash
pnpm db:migrate
```

4. Run API + worker:

```bash
pnpm dev
```

API default: `http://localhost:3007`

## Tests

```bash
pnpm test
```

## Deployment (Railway)

Recommended setup on Railway:

- 1 service for the API: start command `pnpm start` (runs `dist/index.js`)
- 1 service for the worker: start command `pnpm start:worker` (runs `dist/worker.js`)
- 1 Postgres database plugin (Railway-managed)

Required environment variables:

- `DATABASE_URL`
- `ADMIN_TOKEN` (single shared token for pilot admin endpoints)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `RESEND_API_KEY`, `EMAIL_FROM`

## Twilio Webhook

Configure your Twilio phone number (Messaging) to send inbound SMS webhooks to:

- `POST https://<your-domain>/webhooks/twilio/sms`

This service replies by sending outbound SMS via the Twilio REST API (it does not rely on TwiML responses).

## Pilot Admin API

The pilot uses a single shared `ADMIN_TOKEN` to create families, authorized parent phones, and contacts.

Endpoints:

- `POST /admin/families`
- `POST /admin/families/:familyId/authorized-phones`
- `POST /admin/families/:familyId/contacts`
