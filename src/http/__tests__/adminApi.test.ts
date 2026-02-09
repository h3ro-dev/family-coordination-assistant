import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { buildServer } from "../buildServer";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";

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

describe("Admin JSON API (integration)", () => {
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

  test("rejects unauthorized requests", async () => {
    const app = buildServer({ sms, email });
    const res = await app.inject({ method: "POST", url: "/admin/families" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test("create family + authorized phone + contact + clinic task", async () => {
    const app = buildServer({ sms, email });

    const fam = await app.inject({
      method: "POST",
      url: "/admin/families",
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) },
      payload: {
        assistantPhoneE164: ASSISTANT,
        displayName: "Test Family",
        timezone: "America/Denver"
      }
    });
    expect(fam.statusCode).toBe(200);
    const famBody = JSON.parse(fam.body) as { ok: true; family: { id: string } };
    const familyId = famBody.family.id;

    const auth = await app.inject({
      method: "POST",
      url: `/admin/families/${familyId}/authorized-phones`,
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) },
      payload: { phoneE164: PARENT, label: "Primary", role: "primary" }
    });
    expect(auth.statusCode).toBe(200);

    const contact = await app.inject({
      method: "POST",
      url: `/admin/families/${familyId}/contacts`,
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) },
      payload: {
        name: "IHC Clinic",
        category: "clinic",
        phoneE164: "+18015552222",
        channelPref: "sms"
      }
    });
    expect(contact.statusCode).toBe(200);
    const contactBody = JSON.parse(contact.body) as { ok: true; contact: { id: string } };
    const clinicContactId = contactBody.contact.id;

    const task = await app.inject({
      method: "POST",
      url: `/admin/families/${familyId}/tasks`,
      headers: { authorization: basicAuthHeader(process.env.ADMIN_TOKEN!) },
      payload: {
        intentType: "clinic",
        initiatorPhoneE164: PARENT,
        clinicContactId,
        requestText: "Therapy after school next week"
      }
    });
    expect(task.statusCode).toBe(200);
    const taskBody = JSON.parse(task.body) as { ok: true; task: { id: string } };
    const taskId = taskBody.task.id;

    const pool = getPool();
    const outreach = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_outreach WHERE task_id = $1 AND channel = 'voice'",
      [taskId]
    );
    expect(Number(outreach.rows[0].c)).toBe(1);

    await app.close();
  });
});
