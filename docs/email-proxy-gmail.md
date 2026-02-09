# Email Proxy (No Custom Domain Required)

This MVP routes inbound email replies by looking at the recipient address:

- `assistant+<familyId>@<your mailbox domain>`

That works with Gmail plus-addressing, so you can pilot inbound email without owning a domain.

## What This Proxy Does

1. The app sends an email to a contact and sets `Reply-To` to something like:
   - `familyassistant+<familyId>@gmail.com`
2. The contact replies YES/NO.
3. A proxy (Zapier/Make/Apps Script) turns that email into an HTTP POST to the app:
   - `POST /webhooks/email/inbound`
   - Header: `x-inbound-token: <INBOUND_EMAIL_TOKEN>`

## Option 1 (Recommended): Zapier or Make (No Code)

Use Gmail as the mailbox:

- Create a Gmail account for the pilot, example: `familyassistant@gmail.com`
- Set:
  - `EMAIL_REPLY_TO=familyassistant@gmail.com`

Then in Zapier/Make:

- Trigger: "New Email" in Gmail (Inbox)
- Action: "Webhook" POST
  - URL: `https://<your-railway-domain>/webhooks/email/inbound`
  - Headers:
    - `x-inbound-token: <INBOUND_EMAIL_TOKEN>`
    - `content-type: application/json`
  - JSON body (map fields from the Gmail trigger):

```json
{
  "id": "<email id from the trigger>",
  "from": "<from email>",
  "to": "<to email (must include the +familyId tag)>",
  "text": "<plain text body>"
}
```

Notes:

- Make sure you pass the **To** address, not just the base mailbox.
- The app extracts `<familyId>` from the `+...` tag.

## Option 2: Google Apps Script (Small Code, No Paid Tool)

If you do not want Zapier/Make, you can poll for unread messages and forward them.

High-level approach:

- Run a time-based trigger every minute.
- Find unread messages sent to `familyassistant+*@gmail.com`.
- POST `{ id, from, to, text }` to the webhook.
- Mark the email as read after success.

If you want, I can add a ready-to-paste Apps Script snippet and walk through setup step-by-step.

