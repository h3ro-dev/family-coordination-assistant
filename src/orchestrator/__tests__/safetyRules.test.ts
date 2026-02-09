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

describe("Safety rules (integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();

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
    const familyId = fam.rows[0].id;

    await pool.query(
      `
        INSERT INTO family_authorized_phones (family_id, phone_e164, label, role)
        VALUES ($1,$2,'Primary','primary')
      `,
      [familyId, PARENT]
    );

    await pool.query(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'Sarah','sitter',$2,'sms')
      `,
      [familyId, SITTER]
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("max 5 active tasks per family", async () => {
    const baseTime = new Date("2026-02-09T18:00:00Z");

    for (let i = 0; i < 5; i += 1) {
      await handleInboundSms({
        services: { sms, email },
        provider: "fake",
        providerMessageId: `m${i + 1}`,
        from: PARENT,
        to: ASSISTANT,
        text: "Find a sitter Friday 6-10",
        occurredAt: new Date(baseTime.getTime() + i * 60_000)
      });
    }

    // 6th request should be rejected with a clear message.
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m6",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:10:00Z")
    });

    const lastToParent = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(lastToParent.body).toContain("up to 5 active requests");

    const pool = getPool();
    const active = await pool.query<{ c: string }>(
      `
        SELECT COUNT(*)::text as c
        FROM tasks
        WHERE status NOT IN ('confirmed','cancelled','expired')
      `
    );
    expect(Number(active.rows[0].c)).toBe(5);
  });

  test("when awaiting a short parent reply, new texts are treated as that reply (no new task)", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    // Still only 1 task; it's awaiting a time window.
    const pool = getPool();
    const before = await pool.query<{ c: string }>("SELECT COUNT(*)::text as c FROM tasks");
    expect(Number(before.rows[0].c)).toBe(1);

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m2",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const after = await pool.query<{ c: string }>("SELECT COUNT(*)::text as c FROM tasks");
    expect(Number(after.rows[0].c)).toBe(1);

    const outreach = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_outreach"
    );
    expect(Number(outreach.rows[0].c)).toBe(1);

    const parentMsgs = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(parentMsgs.some((b) => b.includes("What day and time?"))).toBe(true);
    expect(parentMsgs.some((b) => b.includes("Asking your sitters now"))).toBe(true);
  });
});

