import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { buildServer } from "../buildServer";

const ASSISTANT = "+18015550000";
const CONTACT_EMAIL = "person@example.com";

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

describe("Inbound email STOP/START", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();
  let familyId: string;
  let contactId: string;

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

    const c = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, email, channel_pref, email_opted_out)
        VALUES ($1,'Contact','sitter',$2,'email',false)
        RETURNING id
      `,
      [familyId, CONTACT_EMAIL]
    );
    contactId = c.rows[0].id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("STOP opts contact out of email and START opts back in", async () => {
    const app = buildServer({ sms, email });

    const stopRes = await app.inject({
      method: "POST",
      url: "/webhooks/email/inbound",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_EMAIL_TOKEN!
      },
      payload: {
        id: "em-stop-1",
        from: CONTACT_EMAIL,
        to: `assistant+${familyId}@example.com`,
        text: "STOP"
      }
    });
    expect(stopRes.statusCode).toBe(200);

    const afterStop = await getPool().query<{ email_opted_out: boolean }>(
      "SELECT email_opted_out FROM contacts WHERE id = $1",
      [contactId]
    );
    expect(afterStop.rows[0]?.email_opted_out).toBe(true);
    expect(email.sent.some((m) => m.to === CONTACT_EMAIL && m.text.includes("opted out"))).toBe(
      true
    );

    email.sent = [];

    const startRes = await app.inject({
      method: "POST",
      url: "/webhooks/email/inbound",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_EMAIL_TOKEN!
      },
      payload: {
        id: "em-start-1",
        from: CONTACT_EMAIL,
        to: `assistant+${familyId}@example.com`,
        text: "START"
      }
    });
    expect(startRes.statusCode).toBe(200);

    const afterStart = await getPool().query<{ email_opted_out: boolean }>(
      "SELECT email_opted_out FROM contacts WHERE id = $1",
      [contactId]
    );
    expect(afterStart.rows[0]?.email_opted_out).toBe(false);
    expect(
      email.sent.some((m) => m.to === CONTACT_EMAIL && m.text.includes("re-subscribed"))
    ).toBe(true);

    await app.close();
  });
});
