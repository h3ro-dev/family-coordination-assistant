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
- `EMAIL_REPLY_TO` (inbound routing; can be a proxy mailbox like a Gmail address)
- `INBOUND_EMAIL_TOKEN` (shared secret required by inbound email webhook)

## Twilio Webhook

Configure your Twilio phone number (Messaging) to send inbound SMS webhooks to:

- `POST https://<your-domain>/webhooks/twilio/sms`

This service replies by sending outbound SMS via the Twilio REST API (it does not rely on TwiML responses).

## Admin UI (Pilot)

The pilot also includes a minimal admin UI (no end-user login):

- `GET /admin-ui`

Auth:

- Browser Basic Auth: username `admin`, password = `ADMIN_TOKEN`
- Or `Authorization: Bearer <ADMIN_TOKEN>`

Use it to create families, authorize parent phones, and manage contacts.

## Inbound Email (Resend or Proxy)

Outbound emails set `Reply-To` to:

- `assistant+<familyId>@<EMAIL_REPLY_TO domain>`

When a contact replies, you (Resend, Zapier, Apps Script, etc.) POST the parsed email to one of:

- `POST /webhooks/resend/inbound`
- `POST /webhooks/email/inbound` (provider-agnostic, recommended for proxies)

Both require a header:

- `x-inbound-token: <INBOUND_EMAIL_TOKEN>`

Minimal JSON payload:

```json
{
  "id": "provider-message-id",
  "from": "Contact <person@example.com>",
  "to": "assistant+<familyId>@example.com",
  "text": "YES"
}
```

## Pilot Admin API

The pilot uses a single shared `ADMIN_TOKEN` to create families, authorized parent phones, and contacts.

Endpoints:

- `POST /admin/families`
- `POST /admin/families/:familyId/authorized-phones`
- `POST /admin/families/:familyId/contacts`
