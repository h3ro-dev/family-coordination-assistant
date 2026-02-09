import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { handleInboundSms } from "../handleInboundSms";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";

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

describe("Parent commands (integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();
  let familyId: string;

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
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("cancel cancels the currently awaiting-parent task", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    const pool = getPool();
    const task = await pool.query<{ id: string; status: string; awaiting_parent: boolean }>(
      "SELECT id, status, awaiting_parent FROM tasks WHERE family_id = $1",
      [familyId]
    );
    expect(task.rows[0].awaiting_parent).toBe(true);

    sms.sent = [];

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m2",
      from: PARENT,
      to: ASSISTANT,
      text: "cancel",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const msg = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(msg.body).toContain("Cancelled");

    const updated = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [task.rows[0].id]
    );
    expect(updated.rows[0].status).toBe("cancelled");
    expect(updated.rows[0].awaiting_parent).toBe(false);
  });

  test("cancel cancels the most recent active task when none is awaiting-parent", async () => {
    // Seed a sitter so the task becomes collecting (not awaiting parent).
    const pool = getPool();
    await pool.query(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
      `,
      [familyId, "+18015550222"]
    );

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    const task = await pool.query<{ id: string; status: string; awaiting_parent: boolean }>(
      "SELECT id, status, awaiting_parent FROM tasks WHERE family_id = $1",
      [familyId]
    );
    expect(task.rows[0].status).toBe("collecting");
    expect(task.rows[0].awaiting_parent).toBe(false);

    sms.sent = [];

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m2",
      from: PARENT,
      to: ASSISTANT,
      text: "cancel task",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const msg = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(msg.body).toContain("Cancelled");

    const updated = await pool.query<{ status: string }>(
      "SELECT status FROM tasks WHERE id = $1",
      [task.rows[0].id]
    );
    expect(updated.rows[0].status).toBe("cancelled");
  });

  test("status lists active requests", async () => {
    const pool = getPool();

    await pool.query(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent)
        VALUES
          ($1,'sitter','collecting',false),
          ($1,'clinic','options_ready',true)
      `,
      [familyId]
    );

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-status",
      from: PARENT,
      to: ASSISTANT,
      text: "status",
      occurredAt: new Date("2026-02-09T18:02:00Z")
    });

    const msg = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(msg.body).toContain("Active requests:");
    expect(msg.body).toContain("sitter: collecting");
    expect(msg.body).toContain("clinic: options_ready");
  });
});
