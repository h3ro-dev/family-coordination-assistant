import { DateTime } from "luxon";
import { withTransaction } from "../db/pool";
import { env } from "../config";
import { AppServices } from "../http/buildServer";
import { JOB_DIAL_VOICE_JOB } from "../jobs/boss";

type VoiceJobRow = {
  id: string;
  family_id: string;
  task_id: string;
  contact_id: string;
  option_id: string | null;
  kind: string;
  status: string;
  attempt: number;
  provider: string;
  provider_call_sid: string | null;
  assistant_phone_e164: string;
  timezone: string;
  contact_name: string;
  contact_phone_e164: string | null;
  voice_opted_out: boolean;
  task_metadata: unknown;
};

function requirePublicBaseUrl(): string {
  const base = env.PUBLIC_BASE_URL;
  if (!base) throw new Error("Missing PUBLIC_BASE_URL (required for Twilio Voice webhooks)");
  return base.replace(/\/+$/, "");
}

function buildVoiceWebhookUrl(path: string, jobId: string): string {
  const base = requirePublicBaseUrl();
  const token = env.TWILIO_VOICE_WEBHOOK_TOKEN;
  const qs = new URLSearchParams();
  qs.set("jobId", jobId);
  if (token) qs.set("token", token);
  return `${base}${path}?${qs.toString()}`;
}

export async function dialVoiceJob(services: AppServices, voiceJobId: string): Promise<void> {
  if (!services.voiceDialer) {
    throw new Error("Voice dialer not configured on worker services");
  }

  const outcome = await withTransaction(async (client) => {
    const res = await client.query<VoiceJobRow>(
      `
        SELECT
          j.id,
          j.family_id,
          j.task_id,
          j.contact_id,
          j.option_id,
          j.kind,
          j.status,
          j.attempt,
          j.provider,
          j.provider_call_sid,
          f.assistant_phone_e164,
          f.timezone,
          c.name as contact_name,
          c.phone_e164 as contact_phone_e164,
          c.voice_opted_out,
          t.metadata as task_metadata
        FROM voice_jobs j
        JOIN families f ON f.id = j.family_id
        JOIN contacts c ON c.id = j.contact_id
        JOIN tasks t ON t.id = j.task_id
        WHERE j.id = $1
        FOR UPDATE
      `,
      [voiceJobId]
    );
    const job = res.rows[0];
    if (!job) return { type: "noop" as const };
    if (job.status !== "queued") return { type: "noop" as const };

    if (job.voice_opted_out) {
      await client.query(
        `
          UPDATE voice_jobs
          SET status = 'failed',
              last_error = 'contact_voice_opted_out',
              updated_at = now()
          WHERE id = $1
        `,
        [job.id]
      );
      return { type: "noop" as const };
    }

    if (!job.contact_phone_e164) {
      await client.query(
        `
          UPDATE voice_jobs
          SET status = 'failed',
              last_error = 'missing_contact_phone',
              updated_at = now()
          WHERE id = $1
        `,
        [job.id]
      );
      return { type: "noop" as const };
    }

    const attempt = job.attempt + 1;
    if (attempt > 3) {
      await client.query(
        `
          UPDATE voice_jobs
          SET status = 'failed',
              last_error = 'max_attempts_exceeded',
              updated_at = now()
          WHERE id = $1
        `,
        [job.id]
      );
      return { type: "noop" as const };
    }

    // Mark as dialing before the external call.
    await client.query(
      `
        UPDATE voice_jobs
        SET status = 'dialing',
            attempt = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [job.id, attempt]
    );

    return { type: "dial" as const, job, attempt };
  });

  if (outcome.type !== "dial") return;

  try {
    const answerUrl = buildVoiceWebhookUrl("/webhooks/twilio/voice/answer", outcome.job.id);
    const statusCallbackUrl = buildVoiceWebhookUrl("/webhooks/twilio/voice/status", outcome.job.id);

    const call = await services.voiceDialer.startCall({
      to: outcome.job.contact_phone_e164 as string,
      from: outcome.job.assistant_phone_e164,
      answerUrl,
      statusCallbackUrl
    });

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE voice_jobs
          SET provider = $2,
              provider_call_sid = $3,
              updated_at = now()
          WHERE id = $1
        `,
        [outcome.job.id, call.provider, call.providerCallId]
      );

      // Mark the "voice outreach" record as sent.
      await client.query(
        `
          UPDATE task_outreach
          SET sent_at = COALESCE(sent_at, now()),
              status = 'sent'
          WHERE task_id = $1 AND contact_id = $2 AND channel = 'voice'
        `,
        [outcome.job.task_id, outcome.job.contact_id]
      );

      // Log an outbound event for visibility in the admin UI.
      await client.query(
        `
          INSERT INTO message_events (
            family_id, task_id, direction, channel, from_addr, to_addr, body,
            provider, provider_message_id, occurred_at
          ) VALUES ($1,$2,'outbound','voice',$3,$4,$5,$6,$7,now())
          ON CONFLICT (provider, provider_message_id) DO NOTHING
        `,
        [
          outcome.job.family_id,
          outcome.job.task_id,
          `family:${outcome.job.family_id}`,
          `contact:${outcome.job.contact_id}`,
          `Started voice ${outcome.job.kind} call to ${outcome.job.contact_name} (attempt ${outcome.attempt}).`,
          call.provider,
          `voice-call:${call.providerCallId}`
        ]
      );
    });
  } catch (err) {
    const msg = String(err);

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE voice_jobs
          SET status = 'failed',
              last_error = $2,
              updated_at = now()
          WHERE id = $1
        `,
        [outcome.job.id, msg.slice(0, 4000)]
      );
    });

    const isConfigError = msg.includes("PUBLIC_BASE_URL");

    // Retry policy (best-effort):
    // - availability calls: retry next day (matches the product "next-day attempt")
    // - booking calls: retry in 10 minutes (short hiccups)
    // Skip retries for obvious configuration errors.
    if (services.boss && !isConfigError) {
      const isAvailability = outcome.job.kind === "availability";
      const startAfter = isAvailability
        ? DateTime.utc().plus({ hours: 24 }).toJSDate()
        : DateTime.utc().plus({ minutes: 10 }).toJSDate();

      await services.boss.send(JOB_DIAL_VOICE_JOB, { voiceJobId: outcome.job.id }, { startAfter });
    }
  }
}

export async function enqueueVoiceJobNow(services: AppServices, voiceJobId: string): Promise<void> {
  if (!services.boss) return;
  await services.boss.send(JOB_DIAL_VOICE_JOB, { voiceJobId }, { startAfter: new Date() });
}
