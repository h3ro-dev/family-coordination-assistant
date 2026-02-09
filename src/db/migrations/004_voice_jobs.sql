-- Voice support (Phase 1+): durable outbound call jobs for availability + booking.

CREATE TABLE IF NOT EXISTS voice_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  option_id uuid NULL REFERENCES task_options(id) ON DELETE SET NULL,
  kind text NOT NULL, -- availability | booking
  status text NOT NULL DEFAULT 'queued', -- queued | dialing | in_progress | completed | failed | cancelled
  attempt int NOT NULL DEFAULT 0,
  provider text NOT NULL DEFAULT 'twilio',
  provider_call_sid text NULL,
  last_transcript text NULL,
  result_json jsonb NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_jobs_task_idx ON voice_jobs(task_id);
CREATE INDEX IF NOT EXISTS voice_jobs_status_idx ON voice_jobs(status);

CREATE UNIQUE INDEX IF NOT EXISTS voice_jobs_provider_call_unique
  ON voice_jobs(provider, provider_call_sid)
  WHERE provider_call_sid IS NOT NULL;

