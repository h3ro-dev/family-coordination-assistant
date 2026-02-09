import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { compileSitterOptions, retrySitterOutreach } from "../sitterJobs";
import { runRetentionCleanup } from "../retentionCleanup";

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

describe("Worker jobs (integration)", () => {
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

  test("compileSitterOptions prompts parent when options exist", async () => {
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
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
        RETURNING id
      `,
      [familyId, SITTER]
    );
    const contactId = contact.rows[0].id;

    const metadata = { initiatorPhoneE164: PARENT };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, requested_start, requested_end, awaiting_parent, metadata)
        VALUES ($1,'sitter','collecting',$2,$3,false,$4::jsonb)
        RETURNING id
      `,
      [
        familyId,
        new Date("2026-02-13T01:00:00.000Z"),
        new Date("2026-02-13T05:00:00.000Z"),
        JSON.stringify(metadata)
      ]
    );
    const taskId = task.rows[0].id;

    await pool.query(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'pending',1)
      `,
      [taskId, contactId, new Date("2026-02-13T01:00:00.000Z"), new Date("2026-02-13T05:00:00.000Z")]
    );

    await compileSitterOptions({ sms, email }, taskId);

    const toParent = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(toParent.some((b) => b.startsWith("Options found:"))).toBe(true);

    const updated = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(updated.rows[0].status).toBe("options_ready");
    expect(updated.rows[0].awaiting_parent).toBe(true);
  });

  test("compileSitterOptions tells parent when no options yet", async () => {
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

    const metadata = { initiatorPhoneE164: PARENT };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, requested_start, requested_end, awaiting_parent, metadata)
        VALUES ($1,'sitter','collecting',$2,$3,false,$4::jsonb)
        RETURNING id
      `,
      [
        familyId,
        new Date("2026-02-13T01:00:00.000Z"),
        new Date("2026-02-13T05:00:00.000Z"),
        JSON.stringify(metadata)
      ]
    );
    const taskId = task.rows[0].id;

    await compileSitterOptions({ sms, email }, taskId);

    const toParent = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(toParent.some((b) => b.includes("No one has replied yet"))).toBe(true);

    const updated = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(updated.rows[0].status).toBe("collecting");
    expect(updated.rows[0].awaiting_parent).toBe(false);
  });

  test("compileSitterOptions does not prompt if another task is awaiting-parent", async () => {
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
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
        RETURNING id
      `,
      [familyId, SITTER]
    );
    const contactId = contact.rows[0].id;

    // Another task is already awaiting the parent.
    await pool.query(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, awaiting_parent_reason, metadata)
        VALUES ($1,'sitter','options_ready',true,'choose_option',$2::jsonb)
      `,
      [familyId, JSON.stringify({ initiatorPhoneE164: PARENT })]
    );

    const metadata = { initiatorPhoneE164: PARENT };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, requested_start, requested_end, awaiting_parent, metadata)
        VALUES ($1,'sitter','collecting',$2,$3,false,$4::jsonb)
        RETURNING id
      `,
      [
        familyId,
        new Date("2026-02-13T01:00:00.000Z"),
        new Date("2026-02-13T05:00:00.000Z"),
        JSON.stringify(metadata)
      ]
    );
    const taskId = task.rows[0].id;

    await pool.query(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'pending',1)
      `,
      [taskId, contactId, new Date("2026-02-13T01:00:00.000Z"), new Date("2026-02-13T05:00:00.000Z")]
    );

    await compileSitterOptions({ sms, email }, taskId);

    // No prompt while another task is awaiting-parent.
    const toParent = sms.sent.filter((m) => m.to === PARENT);
    expect(toParent.length).toBe(0);

    const updated = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(updated.rows[0].status).toBe("collecting");
    expect(updated.rows[0].awaiting_parent).toBe(false);
  });

  test("retrySitterOutreach sends follow-up to non-responders", async () => {
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
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
        RETURNING id
      `,
      [familyId, SITTER]
    );
    const contactId = contact.rows[0].id;

    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, requested_start, requested_end, awaiting_parent)
        VALUES ($1,'sitter','collecting',$2,$3,false)
        RETURNING id
      `,
      [
        familyId,
        new Date("2026-02-13T01:00:00.000Z"),
        new Date("2026-02-13T05:00:00.000Z")
      ]
    );
    const taskId = task.rows[0].id;

    await pool.query(
      `
        INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
        VALUES ($1,$2,'sms',now(),'sent')
      `,
      [taskId, contactId]
    );

    await retrySitterOutreach({ sms, email }, taskId);

    const toSitter = sms.sent.filter((m) => m.to === SITTER).map((m) => m.body);
    expect(toSitter.some((b) => b.startsWith("Quick check: are you available"))).toBe(true);
  });

  test("retention cleanup deletes message_events older than 30 days", async () => {
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
      `
        INSERT INTO message_events (family_id, direction, channel, from_addr, to_addr, body, provider, provider_message_id, occurred_at)
        VALUES
          ($1,'inbound','sms',$2,$3,'old','fake','old-1', now() - interval '31 days'),
          ($1,'inbound','sms',$2,$3,'new','fake','new-1', now())
      `,
      [familyId, PARENT, ASSISTANT]
    );

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'IHC Clinic','clinic',$2,'sms')
        RETURNING id
      `,
      [familyId, SITTER]
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

    await pool.query(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, kind, status, provider, last_transcript, created_at, updated_at)
        VALUES
          ($1,$2,$3,'availability','completed','fake','old transcript', now() - interval '31 days', now() - interval '31 days'),
          ($1,$2,$3,'availability','completed','fake','new transcript', now(), now())
      `,
      [familyId, taskId, contactId]
    );

    await runRetentionCleanup();

    const count = await pool.query<{ c: string }>("SELECT COUNT(*)::text as c FROM message_events");
    expect(Number(count.rows[0].c)).toBe(1);

    const bodies = await pool.query<{ body: string }>("SELECT body FROM message_events");
    expect(bodies.rows[0].body).toBe("new");

    const voiceCount = await pool.query<{ c: string }>("SELECT COUNT(*)::text as c FROM voice_jobs");
    expect(Number(voiceCount.rows[0].c)).toBe(1);
    const voiceBodies = await pool.query<{ last_transcript: string | null }>(
      "SELECT last_transcript FROM voice_jobs"
    );
    expect(voiceBodies.rows[0].last_transcript).toBe("new transcript");
  });
});
