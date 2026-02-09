-- Ensure ON CONFLICT (provider, provider_message_id) works for inbound dedupe.
DROP INDEX IF EXISTS message_events_provider_msg_idx;
CREATE UNIQUE INDEX IF NOT EXISTS message_events_provider_msg_idx
  ON message_events(provider, provider_message_id);

-- Prevent duplicate contact phone numbers within a family.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_family_phone_unique
  ON contacts(family_id, phone_e164);

