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

describe("Progressive onboarding (integration)", () => {
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
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("if no sitters exist, parent can add contacts and the system continues immediately", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    const first = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(first.body).toContain("No sitters saved yet");

    sms.sent = [];

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m2",
      from: PARENT,
      to: ASSISTANT,
      text: "Sarah 801-555-1234; Jenna 801-555-4567",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const msgsToParent = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(msgsToParent.some((b) => b.includes("Saved. Asking them now."))).toBe(true);

    const outreach = sms.sent.filter((m) => m.to !== PARENT);
    expect(outreach.length).toBe(2);
    expect(outreach[0].body).toContain("Reply YES or NO");
    expect(outreach[1].body).toContain("Reply YES or NO");

    const pool = getPool();
    const contacts = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM contacts WHERE category = 'sitter'"
    );
    expect(Number(contacts.rows[0].c)).toBe(2);

    const tasks = await pool.query<{ status: string; awaiting_parent: boolean; awaiting_parent_reason: string | null }>(
      "SELECT status, awaiting_parent, awaiting_parent_reason FROM tasks ORDER BY created_at DESC LIMIT 1"
    );
    expect(tasks.rows[0].status).toBe("collecting");
    expect(tasks.rows[0].awaiting_parent).toBe(false);
    expect(tasks.rows[0].awaiting_parent_reason).toBeNull();
  });
});

