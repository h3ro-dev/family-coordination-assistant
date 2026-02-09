import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { handleInboundSms } from "../handleInboundSms";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";
const SITTER = "+18015550222";

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

describe("Prompt gating (integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();
  let familyId: string;
  let sitterId: string;
  let taskCollectingId: string;

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    sms.sent = [];
    email.sent = [];
    await truncateAll();

    const pool = getPool();
    const fam = await pool.query<{ id: string }>(
      `
        INSERT INTO families (assistant_phone_e164, display_name, timezone)
        VALUES ($1, 'Test Family', 'America/Denver')
        RETURNING id
      `,
      [ASSISTANT]
    );
    familyId = fam.rows[0].id;

    await pool.query(
      `
        INSERT INTO family_authorized_phones (family_id, phone_e164, label, role)
        VALUES ($1,$2,'Primary','primary')
      `,
      [familyId, PARENT]
    );

    const sitter = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
        RETURNING id
      `,
      [familyId, SITTER]
    );
    sitterId = sitter.rows[0].id;

    // Task A: already awaiting a parent reply (choose_option).
    await pool.query(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, awaiting_parent_reason, metadata)
        VALUES ($1,'sitter','options_ready',true,'choose_option',$2::jsonb)
      `,
      [familyId, JSON.stringify({ initiatorPhoneE164: PARENT })]
    );

    // Task B: collecting, with outreach to the sitter.
    const t = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, requested_start, requested_end, awaiting_parent, metadata)
        VALUES ($1,'sitter','collecting',$2,$3,false,$4::jsonb)
        RETURNING id
      `,
      [
        familyId,
        new Date("2026-02-13T01:00:00.000Z"),
        new Date("2026-02-13T05:00:00.000Z"),
        JSON.stringify({ initiatorPhoneE164: PARENT })
      ]
    );
    taskCollectingId = t.rows[0].id;

    await pool.query(
      `
        INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
        VALUES ($1,$2,'sms',now(),'sent')
      `,
      [taskCollectingId, sitterId]
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("a sitter YES does not prompt the parent if another task is already awaiting-parent", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: SITTER,
      to: ASSISTANT,
      text: "YES",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    // No parent prompt while another task is awaiting-parent.
    expect(sms.sent.length).toBe(0);

    const pool = getPool();
    const task = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskCollectingId]
    );
    expect(task.rows[0].status).toBe("collecting");
    expect(task.rows[0].awaiting_parent).toBe(false);

    const options = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_options WHERE task_id = $1",
      [taskCollectingId]
    );
    expect(Number(options.rows[0].c)).toBe(1);
  });
});
