import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { handleInboundSms } from "../handleInboundSms";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";
const SITTER_1 = "+18015550222";
const SITTER_2 = "+18015550333";

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

describe("Sitter SMS flow (integration)", () => {
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
        VALUES
          ($1,'Sarah','sitter',$2,'sms'),
          ($1,'Jenna','sitter',$3,'sms')
      `,
      [familyId, SITTER_1, SITTER_2]
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("parent request -> outreach -> options -> confirm", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    // Ack to parent + 2 outreach messages
    expect(sms.sent.length).toBe(3);
    expect(sms.sent[0].to).toBe(PARENT);
    expect(sms.sent[1].to).toBe(SITTER_1);
    expect(sms.sent[2].to).toBe(SITTER_2);

    // Sitters reply YES
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m2",
      from: SITTER_1,
      to: ASSISTANT,
      text: "YES",
      occurredAt: new Date("2026-02-09T18:05:00Z")
    });

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m3",
      from: SITTER_2,
      to: ASSISTANT,
      text: "yes",
      occurredAt: new Date("2026-02-09T18:06:00Z")
    });

    // Parent should receive options prompt.
    const parentMsgs = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(parentMsgs.some((b) => b.startsWith("Options found:"))).toBe(true);

    // Parent selects option 1.
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m4",
      from: PARENT,
      to: ASSISTANT,
      text: "1",
      occurredAt: new Date("2026-02-09T18:07:00Z")
    });

    const latestParent = sms.sent.filter((m) => m.to === PARENT).slice(-1)[0];
    expect(latestParent.body.startsWith("Confirmed:")).toBe(true);

    const toSitters = sms.sent.filter((m) => m.to === SITTER_1 || m.to === SITTER_2);
    expect(toSitters.some((m) => m.body.includes("You're booked"))).toBe(true);
    expect(toSitters.some((m) => m.body.includes("We’re covered"))).toBe(true);
  });
});
