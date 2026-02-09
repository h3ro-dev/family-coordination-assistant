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

describe("SMS contact behavior (integration)", () => {
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

  test("unknown reply from a sitter triggers a clarification SMS", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-parent-1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    // Parent ack + sitter outreach
    expect(sms.sent.length).toBe(2);
    expect(sms.sent[0].to).toBe(PARENT);
    expect(sms.sent[1].to).toBe(SITTER);

    sms.sent = [];

    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-sitter-1",
      from: SITTER,
      to: ASSISTANT,
      text: "maybe",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const toSitter = sms.sent.filter((m) => m.to === SITTER).map((m) => m.body);
    expect(toSitter.length).toBe(1);
    expect(toSitter[0]).toContain("Quick reply: YES or NO?");

    const toParent = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(toParent.length).toBe(0);

    const pool = getPool();
    const responses = await pool.query<{ response: string }>(
      "SELECT response FROM task_contact_responses ORDER BY received_at DESC LIMIT 1"
    );
    expect(responses.rows[0]?.response).toBe("unknown");

    const options = await pool.query<{ c: string }>("SELECT COUNT(*)::text as c FROM task_options");
    expect(Number(options.rows[0].c)).toBe(0);
  });

  test("STOP opts sitter out of SMS; START opts back in", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-parent-1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    sms.sent = [];

    // Opt out.
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-stop",
      from: SITTER,
      to: ASSISTANT,
      text: "STOP",
      occurredAt: new Date("2026-02-09T18:01:00Z")
    });

    const stopAck = sms.sent.filter((m) => m.to === SITTER).slice(-1)[0];
    expect(stopAck.body).toContain("opted out");

    const pool = getPool();
    const afterStop = await pool.query<{ sms_opted_out: boolean }>(
      "SELECT sms_opted_out FROM contacts WHERE phone_e164 = $1",
      [SITTER]
    );
    expect(afterStop.rows[0]?.sms_opted_out).toBe(true);

    sms.sent = [];

    // Ignored while opted out.
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-yes-after-stop",
      from: SITTER,
      to: ASSISTANT,
      text: "YES",
      occurredAt: new Date("2026-02-09T18:02:00Z")
    });
    expect(sms.sent.length).toBe(0);

    // Opt back in.
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m-start",
      from: SITTER,
      to: ASSISTANT,
      text: "START",
      occurredAt: new Date("2026-02-09T18:03:00Z")
    });

    const startAck = sms.sent.filter((m) => m.to === SITTER).slice(-1)[0];
    expect(startAck.body).toContain("re-subscribed");

    const afterStart = await pool.query<{ sms_opted_out: boolean }>(
      "SELECT sms_opted_out FROM contacts WHERE phone_e164 = $1",
      [SITTER]
    );
    expect(afterStart.rows[0]?.sms_opted_out).toBe(false);
  });
});
