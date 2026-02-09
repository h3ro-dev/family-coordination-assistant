CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_phone_e164 text NOT NULL UNIQUE,
  display_name text NOT NULL,
  timezone text NOT NULL,
  debug_enabled_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_authorized_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  label text NULL,
  role text NOT NULL DEFAULT 'caregiver',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone_e164 text NULL,
  email text NULL,
  category text NOT NULL,
  channel_pref text NOT NULL DEFAULT 'sms',
  sms_opted_out boolean NOT NULL DEFAULT false,
  email_opted_out boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_family_category_idx ON contacts (family_id, category);
CREATE INDEX IF NOT EXISTS contacts_family_phone_idx ON contacts (family_id, phone_e164);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  intent_type text NOT NULL,
  status text NOT NULL,
  requested_start timestamptz NULL,
  requested_end timestamptz NULL,
  awaiting_parent boolean NOT NULL DEFAULT false,
  awaiting_parent_reason text NULL,
  parsed_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_family_status_idx ON tasks (family_id, status);

CREATE TABLE IF NOT EXISTS task_outreach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  sent_at timestamptz NULL,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_outreach_unique_idx ON task_outreach (task_id, contact_id, channel);

CREATE TABLE IF NOT EXISTS task_contact_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  response text NOT NULL,
  response_start timestamptz NULL,
  response_end timestamptz NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  message_event_id uuid NULL,
  UNIQUE (task_id, contact_id)
);

CREATE TABLE IF NOT EXISTS task_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  rank int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_options_task_idx ON task_options (task_id);

CREATE TABLE IF NOT EXISTS message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  task_id uuid NULL REFERENCES tasks(id) ON DELETE SET NULL,
  direction text NOT NULL,
  channel text NOT NULL,
  from_addr text NOT NULL,
  to_addr text NOT NULL,
  body text NOT NULL,
  provider text NOT NULL,
  provider_message_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_events_provider_msg_idx
  ON message_events(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_events_family_occurred_idx
  ON message_events(family_id, occurred_at);

