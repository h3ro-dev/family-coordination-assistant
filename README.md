# Family Coordination Assistant (Phase 1 MVP)

System guide (GitHub Pages):

- https://h3ro-dev.github.io/family-coordination-assistant/
- Recommended architecture/design doc:
  - `docs/recommended-architecture.md`

This is a "coordination orchestrator" for a family (built SMS-first):

1. A parent texts one assistant phone number.
2. The assistant texts or emails the family's existing contacts (sitters, coaches, clinics).
3. It collects replies, turns them into a short list of options, and asks the parent for a simple choice.
4. It confirms the selection and closes the loop.

The product experience is "my assistant talks to my people so I don't have to", but the technical reality is a reliable workflow engine that can handle waiting, retries, and message deduplication.

## Status: What Is Completed

Core functionality (Phase 1):

- Working "request -> outreach -> options -> confirm" loop for the `sitter` intent.
- SMS channel (Twilio):
  - Inbound webhook: `POST /webhooks/twilio/sms`
  - Outbound SMS via Twilio REST API (not TwiML)
  - SMS STOP/START opt-out is supported for SMS contacts (mirrors email opt-out).
- Email channel:
  - Outbound email via Resend
  - Inbound email via:
    - `POST /webhooks/resend/inbound` (Resend-specific)
    - `POST /webhooks/email/inbound` (provider-agnostic, recommended for proxies)
  - Email replies YES/NO are processed into the same task workflow as SMS replies.
  - Email STOP/START opt-out is supported (mirrors SMS opt-out).
- Voice (Phase 1: result ingestion only):
  - Provider-agnostic inbound voice result webhook: `POST /webhooks/voice/result`
    - Requires header: `x-inbound-token: <INBOUND_VOICE_TOKEN>`
    - Accepts a structured result (offered time slots + optional transcript) and converts it into `task_options`.
    - If safe, prompts the parent by SMS with "Options found… Reply 1-N".
  - Admin UI helpers:
    - Create `clinic` / `therapy` tasks (voice channel)
    - Simulate voice results (no provider keys required)
- Progressive onboarding:
  - If parent requests "find a sitter" without a time window, the system asks one follow-up question ("What day and time?").
  - If no sitters exist yet, the system asks the parent to reply with "Name + number" and continues.
- Safety / reliability constraints:
  - Max 5 active tasks per family.
  - Max 1 task awaiting a short parent reply at a time (prevents mixing requests).
  - Parent commands:
    - `STATUS` lists active requests.
    - `CANCEL` cancels the current awaiting-parent request (or the most recent active request).
  - Inbound webhook deduplication via `(provider, provider_message_id)` uniqueness.
  - Per-family sequential processing using row locks on the family record.
- Background jobs (pg-boss):
  - Compile options after 20 minutes.
  - Retry outreach after ~24 hours ("next-day attempt") for contacts that did not reply.
  - Retention cleanup: deletes message history older than 30 days (privacy).
- Pilot admin UI (no end-user login, single admin token):
  - `GET /admin-ui` list families
  - Create family, authorize parent phones, add contacts (SMS/email)
  - View task detail: outreach, responses, options, message log
  - Admin actions: cancel task, compile options now, retry outreach now
- Tests:
  - Unit tests for parsing (time windows, yes/no).
  - Integration test proving end-to-end SMS sitter flow.
  - Integration test proving Twilio SMS route wiring (form webhook -> orchestration).
  - Integration tests proving inbound email proxy flow and email STOP/START.
  - Integration tests proving voice result ingestion (webhook + admin simulation).
  - Integration tests for worker jobs (compile options, next-day retry, retention cleanup).
  - Integration test for safety rules (max 5 active tasks; single awaiting-parent context).
  - Admin UI smoke test (create family via form).

## Status: What Is Not Completed (Still Needed)

To run a real pilot (operational setup):

- Deploy to Railway (API + worker + Postgres) and set environment variables.
- Buy/configure a Twilio number and set its webhook to the Railway URL.
- Configure outbound email (Resend) and decide how you want inbound email replies routed:
  - If you do not have a custom domain yet, use a proxy mailbox (Gmail) and a proxy tool (Zapier/Make/Apps Script) to forward replies to `POST /webhooks/email/inbound`.

To harden for production (recommended next steps, not required for the pilot):

- Verify Twilio webhook signatures (prevents spoofed inbound SMS webhooks).
- Add rate limiting and abuse protection on webhook endpoints.
- Replace "single admin token" with real auth (roles, audit trail).
- Explicit "no PHI" policy enforcement and/or HIPAA-grade controls if pursuing healthcare contracts.
- Additional intents beyond `sitter` (activities, clinic scheduling flows).
- Outbound voice calling (Twilio Voice) + a real voice bridge/agent:
  - Phase 1 currently starts at "voice result received" (structured offered slots).
  - A future voice bridge will be responsible for making the call, handling the conversation, and producing the structured result payload.

## Design (How It Works, In Plain Language)

The system is built around a simple loop that repeats for many coordination problems:

- A parent makes a request ("Find a sitter Friday 6-10").
- The system reaches out to a list of people and waits.
- Replies are turned into options ("Sarah can do it", "Jenna can do it").
- The parent picks one option ("1").
- The system confirms and closes the loop.

The key design decision is: the assistant must be reliable even though messages are not.
People reply late, carriers retry webhooks, servers restart, and messages can arrive out of order.

So we store the workflow state in Postgres and treat SMS/email as "events" that update that state.

## Technical Architecture (What Runs Where)

- API (Fastify):
  - Receives inbound webhooks (Twilio SMS, inbound email proxy).
  - Runs orchestration logic and sends outbound messages.
  - Exposes admin UI + admin JSON endpoints.
- Worker (Node + pg-boss):
  - Runs delayed jobs (compile options, next-day retries, retention cleanup).
- Postgres:
  - The durable source of truth for tasks, outreach, replies, options, and message logs.

Why this matters:

- If the API or worker restarts, nothing is lost: tasks can continue.
- If Twilio retries the same webhook, we dedupe and do not double-process.
- If a sitter replies hours later, we can still match the response to the right task.

## Workflow Engine (State Machine)

Tasks are stored in the `tasks` table and move through states like:

- `intent_created`: a task exists but might still be missing info (ex: time window).
- `collecting`: outreach has been sent; we're waiting for replies.
- `options_ready`: we have at least one viable option; the parent is prompted to choose.
- `confirmed`: parent chose an option; we notify the winner and close the loop.
- `cancelled`: parent/admin cancelled it.

When the system needs a short parent reply, it sets:

- `awaiting_parent=true`
- `awaiting_parent_reason`:
  - `need_time_window`
  - `need_contacts`
  - `choose_option`

This prevents the assistant from asking multiple questions at once and mixing multiple open tasks in a single text thread.

## Data Model (Database Tables)

You don't need to know "databases" to reason about this. Think of these as durable lists:

- `families`: one household account (assistant phone, timezone).
- `family_authorized_phones`: which parent phones are allowed to create requests.
- `contacts`: who the assistant is allowed to reach (phone/email + channel preference + opt-outs).
- `tasks`: the request being coordinated.
- `task_outreach`: who we contacted for a task (and via which channel).
- `task_contact_responses`: YES/NO replies (and later, richer replies).
- `task_options`: the "short list" the parent chooses from.
- `message_events`: the message transcript (inbound + outbound) for debugging and support.

## Webhooks and Endpoints

Inbound:

- Twilio inbound SMS: `POST /webhooks/twilio/sms`
- Resend inbound email (optional): `POST /webhooks/resend/inbound`
- Provider-agnostic inbound email proxy (recommended): `POST /webhooks/email/inbound`
  - Requires header: `x-inbound-token: <INBOUND_EMAIL_TOKEN>`
  - Payload example:
    ```json
    {
      "id": "provider-message-id",
      "from": "Person <person@example.com>",
      "to": "assistant+<familyId>@example.com",
      "text": "YES"
    }
    ```
- Provider-agnostic inbound voice result (Phase 1): `POST /webhooks/voice/result`
  - Requires header: `x-inbound-token: <INBOUND_VOICE_TOKEN>`
  - Payload example:
    ```json
    {
      "id": "provider-message-id",
      "provider": "twilio",
      "familyId": "<uuid>",
      "taskId": "<uuid>",
      "contactId": "<uuid>",
      "transcript": "Receptionist offered: Tue 3:30, Thu 4:15",
      "offeredSlots": [
        { "start": "2026-02-12T22:30:00.000Z", "end": "2026-02-12T23:15:00.000Z" }
      ]
    }
    ```

Admin UI:

- `GET /admin-ui` (requires auth)

Health:

- `GET /health`

## Local Development

1. Start Postgres:

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

## Tests / Release Gates

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Deployment (Railway)

Recommended Railway setup:

- 1 service for the API:
  - Start command: `pnpm start` (runs `dist/index.js`)
- 1 service for the worker:
  - Start command: `pnpm start:worker` (runs `dist/worker.js`)
- 1 Postgres database plugin (Railway-managed)

Required environment variables:

- `DATABASE_URL`
- `ADMIN_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` (used to construct Reply-To as `local+<familyId>@domain`)
- `INBOUND_EMAIL_TOKEN` (shared secret required by inbound email webhook)
- `INBOUND_VOICE_TOKEN` (shared secret required by inbound voice result webhook)

## Admin UI (Pilot)

Open:

- `https://<your-railway-domain>/admin-ui`

Auth:

- Browser Basic Auth: username `admin`, password = `ADMIN_TOKEN`
- Or `Authorization: Bearer <ADMIN_TOKEN>`

## Email Without a Domain (Proxy)

You can pilot inbound email without owning a domain:

- Use Gmail plus-addressing (example: `familyassistant+<familyId>@gmail.com`)
- Set `EMAIL_REPLY_TO` to the Gmail address (example: `familyassistant@gmail.com`)
- Use Zapier/Make/Apps Script to forward replies to `POST /webhooks/email/inbound`

Docs:

- `docs/email-proxy-gmail.md`

## Pilot Runbook

- `docs/pilot-runbook.md`
