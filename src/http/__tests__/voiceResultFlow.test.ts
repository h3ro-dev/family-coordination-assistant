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

describe("Voice result ingestion (integration)", () => {
  const sms = new FakeSmsAdapter();
  const email = new FakeEmailAdapter();

  let familyId: string;
  let contactId: string;
  let taskId: string;

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

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, channel_pref)
        VALUES ($1,'IHC Clinic','clinic','sms')
        RETURNING id
      `,
      [familyId]
    );
    contactId = contact.rows[0].id;

    const metadata = {
      initiatorPhoneE164: PARENT,
      requestText: "Therapy after school next week",
      clinicContactId: contactId
    };

    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
        VALUES ($1,'clinic','collecting',false,$2::jsonb)
        RETURNING id
      `,
      [familyId, JSON.stringify(metadata)]
    );
    taskId = task.rows[0].id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  test("POST /webhooks/voice/result ingests slots and prompts parent", async () => {
    const app = buildServer({ sms, email });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/voice/result",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_VOICE_TOKEN!
      },
      payload: {
        id: "v1",
        provider: "fake",
        familyId,
        taskId,
        contactId,
        transcript: "Receptionist offered: Tue 3:30, Thu 4:15.",
        offeredSlots: [
          { start: "2026-02-12T22:30:00.000Z", end: "2026-02-12T23:15:00.000Z" },
          { start: "2026-02-14T23:15:00.000Z", end: "2026-02-14T23:45:00.000Z" }
        ]
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: true; prompted: boolean; deduped: boolean };
    expect(body.ok).toBe(true);
    expect(body.deduped).toBe(false);
    expect(body.prompted).toBe(true);

    const pool = getPool();
    const opt = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_options WHERE task_id = $1 AND contact_id = $2",
      [taskId, contactId]
    );
    expect(Number(opt.rows[0].c)).toBe(2);

    const task = await pool.query<{
      status: string;
      awaiting_parent: boolean;
      awaiting_parent_reason: string | null;
    }>(
      "SELECT status, awaiting_parent, awaiting_parent_reason FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(task.rows[0].status).toBe("options_ready");
    expect(task.rows[0].awaiting_parent).toBe(true);
    expect(task.rows[0].awaiting_parent_reason).toBe("choose_option");

    const parentMsgs = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(parentMsgs.some((b) => b.startsWith("Options found:"))).toBe(true);

    await app.close();
  });

  test("POST /webhooks/voice/result rejects wrong token", async () => {
    const app = buildServer({ sms, email });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/voice/result",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": "wrong-token"
      },
      payload: {
        id: "v1",
        provider: "fake",
        familyId,
        taskId,
        contactId,
        offeredSlots: [{ start: "2026-02-12T22:30:00.000Z", end: "2026-02-12T23:15:00.000Z" }]
      }
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { ok: false; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unauthorized");

    await app.close();
  });

  test("POST /webhooks/voice/result dedupes repeated webhook id", async () => {
    const app = buildServer({ sms, email });

    const payload = {
      id: "v-dedupe",
      provider: "fake",
      familyId,
      taskId,
      contactId,
      offeredSlots: [{ start: "2026-02-12T22:30:00.000Z", end: "2026-02-12T23:15:00.000Z" }]
    };

    const first = await app.inject({
      method: "POST",
      url: "/webhooks/voice/result",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_VOICE_TOKEN!
      },
      payload
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).deduped).toBe(false);

    const second = await app.inject({
      method: "POST",
      url: "/webhooks/voice/result",
      headers: {
        "content-type": "application/json",
        "x-inbound-token": process.env.INBOUND_VOICE_TOKEN!
      },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).deduped).toBe(true);

    // Only one prompt should have been sent.
    const toParent = sms.sent.filter((m) => m.to === PARENT);
    expect(toParent.length).toBe(1);

    const pool = getPool();
    const opt = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_options WHERE task_id = $1",
      [taskId]
    );
    expect(Number(opt.rows[0].c)).toBe(1);

    await app.close();
  });

  test("Admin UI can simulate voice results for a task", async () => {
    const app = buildServer({ sms, email });

    const res = await app.inject({
      method: "POST",
      url: `/admin-ui/tasks/${taskId}/simulate-voice-result`,
      headers: {
        authorization: basicAuthHeader(process.env.ADMIN_TOKEN!),
        "content-type": "application/x-www-form-urlencoded"
      },
      payload:
        `contactId=${encodeURIComponent(contactId)}` +
        `&slot1Start=${encodeURIComponent("2026-02-12T22:30:00.000Z")}` +
        `&slot1End=${encodeURIComponent("2026-02-12T23:15:00.000Z")}` +
        `&transcript=${encodeURIComponent("Receptionist offered Tue 3:30")}`
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/admin-ui/tasks/${taskId}`);

    const pool = getPool();
    const opt = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text as c FROM task_options WHERE task_id = $1",
      [taskId]
    );
    expect(Number(opt.rows[0].c)).toBe(1);

    const parentMsgs = sms.sent.filter((m) => m.to === PARENT).map((m) => m.body);
    expect(parentMsgs.some((b) => b.startsWith("Options found:"))).toBe(true);

    await app.close();
  });
});

