import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { buildServer } from "../buildServer";

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

describe("Twilio SMS webhook route (integration)", () => {
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

  test("accepts Twilio form payload and triggers orchestration", async () => {
    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload:
        "MessageSid=m1" +
        `&From=${encodeURIComponent(PARENT)}` +
        `&To=${encodeURIComponent(ASSISTANT)}` +
        `&Body=${encodeURIComponent("Find a sitter Friday 6-10")}`
    });

    expect(res.statusCode).toBe(200);

    expect(sms.sent.length).toBe(2);
    expect(sms.sent[0].to).toBe(PARENT);
    expect(sms.sent[1].to).toBe(SITTER);

    await app.close();
  });

  test("dedupes Twilio retries with same MessageSid", async () => {
    const app = buildServer({ sms, email });

    const payload =
      "MessageSid=dedupe-1" +
      `&From=${encodeURIComponent(PARENT)}` +
      `&To=${encodeURIComponent(ASSISTANT)}` +
      `&Body=${encodeURIComponent("Find a sitter Friday 6-10")}`;

    const first = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload
    });
    expect(first.statusCode).toBe(200);
    expect(sms.sent.length).toBe(2);

    const second = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload
    });
    expect(second.statusCode).toBe(200);

    // No additional outbound messages for a retried webhook.
    expect(sms.sent.length).toBe(2);

    await app.close();
  });

  test("rejects missing From/To", async () => {
    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "MessageSid=m1&Body=Hello"
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
