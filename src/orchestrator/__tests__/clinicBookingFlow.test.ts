import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import PgBoss from "pg-boss";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { JOB_DIAL_VOICE_JOB } from "../../jobs/boss";
import { handleInboundSms } from "../handleInboundSms";

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

describe("Clinic booking loop (integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    sms.sent = [];
    email.sent = [];
    await truncateAll();
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("parent choice creates a booking voice_job and enqueues dialing", async () => {
    const pool = getPool();
    const fam = await pool.query<{ id: string; timezone: string }>(
      `
        INSERT INTO families (assistant_phone_e164, display_name, timezone)
        VALUES ($1, 'Test Family', 'America/Denver')
        RETURNING id, timezone
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

    const meta = { initiatorPhoneE164: PARENT, clinicContactId: contactId };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, awaiting_parent_reason, metadata)
        VALUES ($1,'clinic','options_ready',true,'choose_option',$2::jsonb)
        RETURNING id
      `,
      [familyId, JSON.stringify(meta)]
    );
    const taskId = task.rows[0].id;

    const opt1 = await pool.query<{ id: string }>(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'pending',1)
        RETURNING id
      `,
      [taskId, contactId, new Date("2026-02-12T22:30:00.000Z"), new Date("2026-02-12T23:15:00.000Z")]
    );
    await pool.query(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'pending',2)
      `,
      [taskId, contactId, new Date("2026-02-14T23:15:00.000Z"), new Date("2026-02-14T23:45:00.000Z")]
    );

    const boss = { send: vi.fn(async () => {}) };

    await handleInboundSms({
      services: { sms, email, boss: boss as unknown as PgBoss },
      provider: "fake",
      providerMessageId: "m-parent-choice-1",
      from: PARENT,
      to: ASSISTANT,
      text: "1",
      occurredAt: new Date("2026-02-10T18:00:00.000Z")
    });

    // Worker job enqueued
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = boss.send.mock.calls[0] as unknown as [string, { voiceJobId: string }];
    expect(jobName).toBe(JOB_DIAL_VOICE_JOB);
    expect(jobData.voiceJobId).toBeTruthy();

    // Booking voice job created
    const jobs = await pool.query<{ kind: string; status: string; option_id: string | null }>(
      "SELECT kind, status, option_id FROM voice_jobs WHERE task_id = $1",
      [taskId]
    );
    expect(jobs.rows.length).toBe(1);
    expect(jobs.rows[0]?.kind).toBe("booking");
    expect(jobs.rows[0]?.status).toBe("queued");
    expect(jobs.rows[0]?.option_id).toBe(opt1.rows[0].id);

    const updatedTask = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(updatedTask.rows[0]?.status).toBe("booking");
    expect(updatedTask.rows[0]?.awaiting_parent).toBe(false);

    // Parent gets an immediate acknowledgement.
    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0]?.to).toBe(PARENT);
    expect(sms.sent[0]?.body).toContain("Calling IHC Clinic");
  });
});

