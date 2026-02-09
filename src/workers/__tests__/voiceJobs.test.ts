import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { FakeVoiceDialer } from "../../adapters/voice/FakeVoiceDialer";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { dialVoiceJob } from "../voiceJobs";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";
const CLINIC_PHONE = "+18015550999";

async function truncateAll() {
  const pool = getPool();
  await pool.query(`
    TRUNCATE
      message_events,
      voice_jobs,
      task_options,
      task_contact_responses,
      task_outreach,
      tasks,
      contacts,
      family_authorized_phones,
      families
    CASCADE;
  `);
}

describe("Voice jobs (worker integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();
  const voiceDialer = new FakeVoiceDialer();

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    sms.sent = [];
    email.sent = [];
    voiceDialer.calls = [];
    await truncateAll();
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("dialVoiceJob starts an outbound call and logs an event", async () => {
    const pool = getPool();
    const fam = await pool.query<{ id: string }>(
      `
        INSERT INTO families (assistant_phone_e164, display_name, timezone)
        VALUES ($1, 'Test Family', 'America/Denver')
        RETURNING id
      `,
      [ASSISTANT]
    );
    const familyId = fam.rows[0].id;

    await pool.query(
      `INSERT INTO family_authorized_phones (family_id, phone_e164, label, role) VALUES ($1,$2,'Primary','primary')`,
      [familyId, PARENT]
    );

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'IHC Clinic','clinic',$2,'sms')
        RETURNING id
      `,
      [familyId, CLINIC_PHONE]
    );
    const contactId = contact.rows[0].id;

    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
        VALUES ($1,'clinic','collecting',false,$2::jsonb)
        RETURNING id
      `,
      [familyId, JSON.stringify({ initiatorPhoneE164: PARENT, clinicContactId: contactId })]
    );
    const taskId = task.rows[0].id;

    await pool.query(
      `
        INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
        VALUES ($1,$2,'voice',NULL,'queued')
      `,
      [taskId, contactId]
    );

    const job = await pool.query<{ id: string }>(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, kind, status, provider)
        VALUES ($1,$2,$3,'availability','queued','fake')
        RETURNING id
      `,
      [familyId, taskId, contactId]
    );
    const voiceJobId = job.rows[0].id;

    await dialVoiceJob({ sms, email, voiceDialer }, voiceJobId);

    expect(voiceDialer.calls.length).toBe(1);
    expect(voiceDialer.calls[0]?.to).toBe(CLINIC_PHONE);
    expect(voiceDialer.calls[0]?.from).toBe(ASSISTANT);
    expect(voiceDialer.calls[0]?.answerUrl).toContain("/webhooks/twilio/voice/answer");

    const dbJob = await pool.query<{ status: string; provider: string; provider_call_sid: string | null }>(
      "SELECT status, provider, provider_call_sid FROM voice_jobs WHERE id = $1",
      [voiceJobId]
    );
    expect(dbJob.rows[0]?.status).toBe("dialing");
    expect(dbJob.rows[0]?.provider).toBe("fake");
    expect(dbJob.rows[0]?.provider_call_sid).toBeTruthy();

    const outreach = await pool.query<{ status: string; sent_at: Date | null }>(
      "SELECT status, sent_at FROM task_outreach WHERE task_id = $1 AND contact_id = $2 AND channel = 'voice'",
      [taskId, contactId]
    );
    expect(outreach.rows[0]?.status).toBe("sent");
    expect(outreach.rows[0]?.sent_at).toBeTruthy();

    const events = await pool.query<{ direction: string; channel: string; body: string }>(
      "SELECT direction, channel, body FROM message_events WHERE task_id = $1 ORDER BY occurred_at ASC",
      [taskId]
    );
    expect(events.rows.some((e) => e.direction === "outbound" && e.channel === "voice")).toBe(true);
  });

  test("dialVoiceJob fails fast when contact has no phone", async () => {
    const pool = getPool();
    const fam = await pool.query<{ id: string }>(
      `
        INSERT INTO families (assistant_phone_e164, display_name, timezone)
        VALUES ($1, 'Test Family', 'America/Denver')
        RETURNING id
      `,
      [ASSISTANT]
    );
    const familyId = fam.rows[0].id;

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, channel_pref)
        VALUES ($1,'IHC Clinic','clinic','sms')
        RETURNING id
      `,
      [familyId]
    );
    const contactId = contact.rows[0].id;

    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
        VALUES ($1,'clinic','collecting',false,'{}'::jsonb)
        RETURNING id
      `,
      [familyId]
    );
    const taskId = task.rows[0].id;

    const job = await pool.query<{ id: string }>(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, kind, status, provider)
        VALUES ($1,$2,$3,'availability','queued','fake')
        RETURNING id
      `,
      [familyId, taskId, contactId]
    );
    const voiceJobId = job.rows[0].id;

    await dialVoiceJob({ sms, email, voiceDialer }, voiceJobId);

    expect(voiceDialer.calls.length).toBe(0);
    const dbJob = await pool.query<{ status: string; last_error: string | null }>(
      "SELECT status, last_error FROM voice_jobs WHERE id = $1",
      [voiceJobId]
    );
    expect(dbJob.rows[0]?.status).toBe("failed");
    expect(dbJob.rows[0]?.last_error).toBe("missing_contact_phone");
  });
});

