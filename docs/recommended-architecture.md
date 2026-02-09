# Recommended Architecture (Phase 1 -> Scale)

This document explains the recommended architecture for the Family Coordination Assistant as it
grows from a Phase 1 pilot into a reliable system used every day.

It is written in plain language: if you understand "what each part does" and "what can go wrong",
you can reason about the design without being a software engineer.

## What This Product Is

The user-facing product is:

- "My assistant talks to my people so I don't have to."

The technical product is:

- A durable workflow engine that can send messages, wait, retry, summarize options, and confirm a
  choice without getting confused.

## Explicit Boundaries (What Is and Is Not Built)

### Built now (Phase 1 MVP)

- SMS assistant (parent texts one number).
- Outreach to contacts via SMS or email.
- Collection of replies and conversion into a short list of options.
- Parent choice (reply 1/2/3) and confirmation.
- Safety rules:
  - max 5 active tasks per family
  - max 1 task awaiting a short parent reply at a time
- Voice: **result ingestion only**:
  - The core system can accept a structured "voice result" payload and turn it into options for
    the parent.
  - It does not place phone calls yet.

### Not built yet (by design)

- Placing phone calls to clinics (Twilio Voice).
- A voice agent that handles the conversation (Grok/OpenAI/etc.).
- Calendar booking integrations.
- Real end-user accounts, dashboards, marketplace, payments.
- HIPAA compliance program (BAAs, audits, policies).

## The Core Idea: Coordination Core + Adapters

As this system scales, keep one "coordination core" that is boring and reliable, and treat each
communication method (SMS/email/voice) as a replaceable adapter.

- The core owns: tasks, state machine, safety rules, retries, and durable storage.
- Adapters own: translating provider-specific payloads into a stable core contract, and sending
  messages/calls via providers.

This avoids the most common failure mode in assistants: a smart layer that is "impressive" but
unreliable when messages arrive late, duplicated, or out of order.

## Components (What Runs Where)

### 1) Coordination Core (this repo)

Runs as:

- API process (Fastify)
- Worker process (pg-boss jobs)
- Postgres (durable storage)

Responsibilities:

- Receive inbound webhooks (Twilio SMS, inbound email proxy, voice results).
- Update the task state machine.
- Send outbound SMS/email.
- Run delayed jobs (compile options, retry tomorrow, retention cleanup).
- Enforce safety rules so the system doesn't mix up requests.

### 2) Voice Bridge (future service)

The voice bridge is a separate service that:

1. Places an outbound phone call (Twilio Voice).
2. Runs a conversation (voice agent).
3. Extracts the result into a structured payload:
   - offered time slots
   - (optional) a short transcript/note
4. Posts the result to the coordination core:
   - `POST /webhooks/voice/result`

Why separate it:

- Phone calls are long-running, messy, and failure-prone (holds, transfers, voicemail).
- Voice introduces higher privacy risk (audio/transcripts).
- Iterating on a call script/agent should not destabilize the core workflow engine.

## Data Model (How the Core Remembers Things)

The database is just a set of durable lists:

- `families`: the household
- `family_authorized_phones`: which parent phones can create tasks
- `contacts`: who we can reach (sitter/coach/clinic/therapy) + opt-outs
- `tasks`: a single coordination job ("Find a sitter Fri 6-10")
- `task_outreach`: who we contacted for a task (and via what channel)
- `task_contact_responses`: replies (YES/NO/etc.)
- `task_options`: the short list shown to the parent
- `message_events`: the transcript/log for debugging (retained 30 days)

Durable storage matters because:

- Providers retry webhooks.
- People reply late.
- Servers restart.
- You still need to complete the workflow correctly.

## Workflow Engine (State Machine)

The key task states are:

- `intent_created` (task exists but may be missing info)
- `collecting` (outreach sent; waiting for replies)
- `options_ready` (we have options; parent must pick 1/2/3)
- `confirmed` (task closed)
- `cancelled` (task closed)

The most important safety flag is:

- `awaiting_parent=true`

This prevents mixing contexts. Only one task per family is allowed to be waiting on a short parent
reply at a time.

## Contracts (Stable Interfaces)

### Inbound voice result (stable core contract)

- Endpoint: `POST /webhooks/voice/result`
- Auth: `x-inbound-token: <INBOUND_VOICE_TOKEN>`

Payload shape (minimal):

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

The voice bridge can be replaced as long as it reliably produces this payload.

## Scaling Path (Without Premature Complexity)

Phase 1 scaling strategy:

- Run multiple API instances safely because:
  - inbound events are deduped (provider message id uniqueness)
  - per-family row locks serialize processing for a family
- Run multiple workers safely because job handlers lock the task row while updating state.

Phase 2+ scaling options (only if needed):

- Add explicit rate limiting on inbound webhooks.
- Add request tracing and metrics (success rate, time-to-confirm, drop-off).
- Add an "outbox" pattern if provider sends become a bottleneck (ensure exactly-once sends).

Avoid:

- Splitting the coordination core into many microservices too early.
- Putting the state machine inside the voice agent.

## Privacy / HIPAA Notes

Phase 1 is "HIPAA-ready" in structure (durable logs, retention cleanup, access controls), but not
HIPAA compliant by default.

If healthcare contracts become real, the likely steps include:

- BAAs with providers (Twilio, hosting, email, etc.)
- tighter retention / redaction policies (especially for transcripts)
- access logging and role-based controls for operators

## Next Recommended Build (If You Want Voice Calling)

Build a small voice bridge that:

1. Pulls a queued "clinic task" from the core (or is triggered manually).
2. Places a call via Twilio Voice.
3. Uses a voice agent to ask: "What appointments are available next week after 3pm?"
4. Extracts offered slots and POSTs them to `POST /webhooks/voice/result`.

The coordination core is already prepared for step (4).

