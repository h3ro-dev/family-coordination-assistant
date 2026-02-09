-- Voice support (Phase 1): store opt-out and improve lookup indexes.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS voice_opted_out boolean NOT NULL DEFAULT false;

-- Useful for task-level channel filtering (sms/email/voice).
CREATE INDEX IF NOT EXISTS task_outreach_task_channel_idx
  ON task_outreach(task_id, channel);

-- Helpful when preventing duplicates / aggregating options by contact.
CREATE INDEX IF NOT EXISTS task_options_task_contact_idx
  ON task_options(task_id, contact_id);

