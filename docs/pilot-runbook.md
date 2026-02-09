# Pilot Runbook (Phase 1)

This MVP is a "coordination orchestrator":

- A **parent** texts one assistant number.
- The assistant contacts the family's existing **contacts** (sitters, coaches, clinics) via SMS or email.
- The assistant collects replies and sends the parent a short list of options to choose from.

Key design constraints (safety + simplicity):

- Max 5 active requests per family
- Max 1 request waiting on a parent reply at a time
- Message history is retained for 30 days, then deleted (privacy)

## Terms (plain English)

- **Family**: One household account in the system.
- **Authorized parent phone**: Phone numbers allowed to create requests for that family.
- **Contact**: A person the assistant can reach (sitter/coach/clinic) using SMS or email.
- **Task**: One request (example: "Find a sitter Fri 6-10").

## What You Need For a Real Pilot

- 1 Twilio phone number (this is the assistant phone)
- 1 Railway project running:
  - API service
  - Worker service
  - Postgres
- Optional: an email setup for outbound (Resend)
- Optional: an inbound email proxy (no custom domain required; Gmail + Zapier/Make works)

## Railway Environment Variables

Required:

- `DATABASE_URL`
- `ADMIN_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `INBOUND_EMAIL_TOKEN`
- `INBOUND_VOICE_TOKEN` (required if using the voice result webhook)

Notes:

- If you do not set email vars, SMS-only still works.
- If you do not set `EMAIL_REPLY_TO` + inbound proxy, email replies will not be processed.

## Twilio Setup

In Twilio Console for your phone number:

- Set Messaging webhook URL to:
  - `POST https://<your-railway-domain>/webhooks/twilio/sms`

## Admin UI Setup

Open:

- `https://<your-railway-domain>/admin-ui`

Login:

- Username: `admin`
- Password: the value of `ADMIN_TOKEN`

Create one family:

1. Assistant phone: the Twilio number in E.164 (example `+18015550000`)
2. Display name: whatever you want
3. Timezone: pick the family's timezone

Then add:

1. Authorized parent phones (the parent(s) who will text the assistant)
2. Contacts (sitters, etc.)
   - `channel_pref=sms` means the contact is reached by SMS
   - `channel_pref=email` means the contact is reached by email

## Happy Path Smoke Test (Sitter)

1. Parent texts the assistant:
   - "Find a sitter Friday 6-10"
2. Assistant responds to parent:
   - "Got it. Asking your sitters now."
3. Contacts receive an availability check and reply YES/NO.
4. Parent receives:
   - "Options found: ..."
5. Parent replies:
   - "1"
6. System confirms to parent and notifies the selected contact.

## If You Have No Custom Email Domain Yet (Proxy)

You can still do email replies without owning a domain:

- Set `EMAIL_REPLY_TO` to a mailbox you control (Gmail works).
- Use an automation tool (Zapier/Make) to forward inbound emails to:
  - `POST https://<your-railway-domain>/webhooks/email/inbound`
  - Header: `x-inbound-token: <INBOUND_EMAIL_TOKEN>`

See `docs/email-proxy-gmail.md` for concrete options.

## Hybrid Healthcare Flow (Phase 1): Voice Result Ingestion

Important: Phase 1 does **not** place phone calls yet. It supports the second half of the loop:

1. A clinic/therapy office is contacted by phone (manually or by a future “voice bridge”).
2. The result is posted to the API as structured offered time slots.
3. The parent receives an SMS with “Options found… Reply 1-N”.

### Inbound Voice Result Webhook

Endpoint:

- `POST https://<your-railway-domain>/webhooks/voice/result`
- Header: `x-inbound-token: <INBOUND_VOICE_TOKEN>`

Minimal payload example:

```json
{
  "id": "provider-message-id",
  "provider": "twilio",
  "familyId": "<uuid>",
  "taskId": "<uuid>",
  "contactId": "<uuid>",
  "transcript": "Receptionist offered Tue 3:30, Thu 4:15",
  "offeredSlots": [
    { "start": "2026-02-12T22:30:00.000Z", "end": "2026-02-12T23:15:00.000Z" }
  ]
}
```

### Smoke Test Without Any Voice Provider Keys (Admin UI)

You can prove the “voice result -> parent choice” loop works today:

1. In Admin UI, create a family and authorize the parent phone.
2. Add a clinic/therapy contact (category `clinic` or `therapy`).
3. On the family page, use “Create Clinic/Therapy Task (Voice)”.
4. Open the task and use “Simulate Voice Result” to enter:
   - optional transcript
   - 1-3 offered time slots
5. Confirm the parent phone receives “Options found… Reply 1-N”.

This is the core boundary: the future voice system only needs to reliably call and produce the
structured `offeredSlots[]` payload.
