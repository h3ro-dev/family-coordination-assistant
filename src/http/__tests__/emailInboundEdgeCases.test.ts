import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { handleInboundSms } from "../../orchestrator/handleInboundSms";
import { buildServer } from "../buildServer";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";
const SITTER_EMAIL = "sitter@example.com";

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

describe("Inbound email edge cases (integration)", () => {
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

    await pool.query(
      `
        INSERT INTO contacts (family_id, name, category, email, channel_pref)
        VALUES ($1,'Erin','sitter',$2,'email')
      `,
      [familyId, SITTER_EMAIL]
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("unknown email reply triggers a clarification email", async () => {
    await handleInboundSms({
      services: { sms, email },
      provider: "fake",
      providerMessageId: "m1",
      from: PARENT,
      to: ASSISTANT,
      text: "Find a sitter Friday 6-10",
      occurredAt: new Date("2026-02-09T18:00:00Z")
    });

    expect(email.sent.length).toBe(1);
    email.sent = [];

    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/email/inbound",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_EMAIL_TOKEN!
      },
      payload: {
        id: "em-unknown-1",
        from: `Erin <${SITTER_EMAIL}>`,
        to: `assistant+${familyId}@example.com`,
        text: "maybe"
      }
    });
    expect(res.statusCode).toBe(200);

    expect(
      email.sent.some((m) => m.to === SITTER_EMAIL && m.text.includes("Quick reply: YES or NO?"))
    ).toBe(true);

    // Should not prompt parent since response is unknown and no YES options exist.
    const toParent = sms.sent.filter((m) => m.to === PARENT);
    expect(toParent.length).toBe(1); // only the initial ack from handleInboundSms

    await app.close();
  });

  test("rejects wrong inbound token", async () => {
    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/email/inbound",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": "wrong-token"
      },
      payload: {
        id: "em1",
        from: `Erin <${SITTER_EMAIL}>`,
        to: `assistant+${familyId}@example.com`,
        text: "YES"
      }
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test("rejects missing family routing (no +<familyId> tag)", async () => {
    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/email/inbound",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_EMAIL_TOKEN!
      },
      payload: {
        id: "em1",
        from: `Erin <${SITTER_EMAIL}>`,
        to: "assistant@example.com",
        text: "YES"
      }
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

