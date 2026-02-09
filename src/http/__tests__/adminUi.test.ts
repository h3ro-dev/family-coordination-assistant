import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { buildServer } from "../buildServer";

function basicAuthHeader(password: string): string {
  const token = Buffer.from(`admin:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

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

describe("Admin UI", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("create family via form + list it", async () => {
    const app = buildServer({ sms, email });

    const res = await app.inject({
      method: "POST",
      url: "/admin-ui/families/new",
      headers: {
        authorization: basicAuthHeader(process.env.ADMIN_TOKEN!),
        "content-type": "application/x-www-form-urlencoded"
      },
      payload:
        "assistantPhoneE164=801-555-0000&displayName=Test+Fam&timezone=America%2FDenver"
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin-ui\/families\//);

    const list = await app.inject({
      method: "GET",
      url: "/admin-ui",
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) }
    });

    expect(list.statusCode).toBe(200);
    expect(list.body).toContain("Test Fam");
    expect(list.body).toContain("+18015550000");

    await app.close();
  });

  test("shows email opt-out status on family page", async () => {
    const pool = getPool();
    const fam = await pool.query<{ id: string }>(
      `
        INSERT INTO families (assistant_phone_e164, display_name, timezone)
        VALUES ($1, 'Test Family', 'America/Denver')
        RETURNING id
      `,
      ["+18015550000"]
    );
    const familyId = fam.rows[0].id;
    await pool.query(
      `
        INSERT INTO contacts (family_id, name, category, email, channel_pref, email_opted_out)
        VALUES ($1,'Erin','sitter','erin@example.com','email',true)
      `,
      [familyId]
    );

    const app = buildServer({ sms, email });
    const res = await app.inject({
      method: "GET",
      url: `/admin-ui/families/${familyId}`,
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Email opted out");

    await app.close();
  });
});
