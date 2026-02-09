import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeSmsAdapter } from "../../adapters/sms/FakeSmsAdapter";
import { FakeEmailAdapter } from "../../adapters/email/FakeEmailAdapter";
import { runMigrations } from "../../db/runMigrations";
import { getPool } from "../../db/pool";
import { buildServer } from "../buildServer";

const ASSISTANT = "+18015550000";
const PARENT = "+18015550111";
const CLINIC_PHONE = "+18015550999";

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

describe("Twilio Voice (integration)", () => {
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

  test("availability call: answer -> gather -> options prompt", async () => {
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
      `INSERT INTO family_authorized_phones (family_id, phone_e164, label, role) VALUES ($1,$2,'Primary','primary')`,
      [familyId, PARENT]
    );

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'IHC Clinic','clinic',$2,'sms')
        RETURNING id
      `,
      [familyId, CLINIC_PHONE]
    );
    const contactId = contact.rows[0].id;

    const taskMeta = {
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
      [familyId, JSON.stringify(taskMeta)]
    );
    const taskId = task.rows[0].id;

    const voiceJob = await pool.query<{ id: string }>(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, kind, status, provider)
        VALUES ($1,$2,$3,'availability','queued','twilio')
        RETURNING id
      `,
      [familyId, taskId, contactId]
    );
    const voiceJobId = voiceJob.rows[0].id;

    const app = buildServer({ sms, email });

    const ans = await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/answer?jobId=${encodeURIComponent(voiceJobId)}&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `CallSid=${encodeURIComponent("CA_TEST_1")}`
    });
    expect(ans.statusCode).toBe(200);
    expect(ans.headers["content-type"]).toContain("text/xml");
    expect(ans.body).toContain("<Gather");

    const gather = await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/gather?jobId=${encodeURIComponent(voiceJobId)}&turn=1&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload:
        `CallSid=${encodeURIComponent("CA_TEST_1")}` +
        `&SpeechResult=${encodeURIComponent("2/12/2026 3:30pm and 2/14/2026 4:15pm")}`
    });
    expect(gather.statusCode).toBe(200);

    // Parent should be prompted with options.
    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0]?.to).toBe(PARENT);
    expect(sms.sent[0]?.body).toContain("Options found:");

    const jobRow = await pool.query<{ status: string }>("SELECT status FROM voice_jobs WHERE id = $1", [
      voiceJobId
    ]);
    expect(jobRow.rows[0]?.status).toBe("completed");

    const taskRow = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(taskRow.rows[0]?.status).toBe("options_ready");
    expect(taskRow.rows[0]?.awaiting_parent).toBe(true);

    await app.close();
  });

  test("booking call: gather YES confirms and texts parent", async () => {
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
      `INSERT INTO family_authorized_phones (family_id, phone_e164, label, role) VALUES ($1,$2,'Primary','primary')`,
      [familyId, PARENT]
    );

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'IHC Clinic','clinic',$2,'sms')
        RETURNING id
      `,
      [familyId, CLINIC_PHONE]
    );
    const contactId = contact.rows[0].id;

    const taskMeta = { initiatorPhoneE164: PARENT, clinicContactId: contactId };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
        VALUES ($1,'clinic','booking',false,$2::jsonb)
        RETURNING id
      `,
      [familyId, JSON.stringify(taskMeta)]
    );
    const taskId = task.rows[0].id;

    const option = await pool.query<{ id: string }>(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'selected',1)
        RETURNING id
      `,
      [taskId, contactId, new Date("2026-02-12T22:30:00.000Z"), new Date("2026-02-12T23:15:00.000Z")]
    );

    const voiceJob = await pool.query<{ id: string }>(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, option_id, kind, status, provider)
        VALUES ($1,$2,$3,$4,'booking','queued','twilio')
        RETURNING id
      `,
      [familyId, taskId, contactId, option.rows[0].id]
    );
    const voiceJobId = voiceJob.rows[0].id;

    const app = buildServer({ sms, email });

    const ans = await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/answer?jobId=${encodeURIComponent(voiceJobId)}&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `CallSid=${encodeURIComponent("CA_BOOK_1")}`
    });
    expect(ans.statusCode).toBe(200);
    expect(ans.body).toContain("confirm");

    const gather = await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/gather?jobId=${encodeURIComponent(voiceJobId)}&turn=1&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload:
        `CallSid=${encodeURIComponent("CA_BOOK_1")}` + `&SpeechResult=${encodeURIComponent("Yes")}`
    });
    expect(gather.statusCode).toBe(200);

    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0]?.to).toBe(PARENT);
    expect(sms.sent[0]?.body).toContain("Confirmed with IHC Clinic");

    const taskRow = await pool.query<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [
      taskId
    ]);
    expect(taskRow.rows[0]?.status).toBe("confirmed");

    const jobRow = await pool.query<{ status: string }>("SELECT status FROM voice_jobs WHERE id = $1", [
      voiceJobId
    ]);
    expect(jobRow.rows[0]?.status).toBe("completed");

    await app.close();
  });

  test("booking call: gather NO releases options back to parent", async () => {
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
      `INSERT INTO family_authorized_phones (family_id, phone_e164, label, role) VALUES ($1,$2,'Primary','primary')`,
      [familyId, PARENT]
    );

    const contact = await pool.query<{ id: string }>(
      `
        INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
        VALUES ($1,'IHC Clinic','clinic',$2,'sms')
        RETURNING id
      `,
      [familyId, CLINIC_PHONE]
    );
    const contactId = contact.rows[0].id;

    const taskMeta = { initiatorPhoneE164: PARENT, clinicContactId: contactId };
    const task = await pool.query<{ id: string }>(
      `
        INSERT INTO tasks (family_id, intent_type, status, awaiting_parent, metadata)
        VALUES ($1,'clinic','booking',false,$2::jsonb)
        RETURNING id
      `,
      [familyId, JSON.stringify(taskMeta)]
    );
    const taskId = task.rows[0].id;

    const opt1 = await pool.query<{ id: string }>(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'selected',1)
        RETURNING id
      `,
      [taskId, contactId, new Date("2026-02-12T22:30:00.000Z"), new Date("2026-02-12T23:15:00.000Z")]
    );
    const opt2 = await pool.query<{ id: string }>(
      `
        INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
        VALUES ($1,$2,$3,$4,'rejected',2)
        RETURNING id
      `,
      [taskId, contactId, new Date("2026-02-14T23:15:00.000Z"), new Date("2026-02-14T23:45:00.000Z")]
    );

    const voiceJob = await pool.query<{ id: string }>(
      `
        INSERT INTO voice_jobs (family_id, task_id, contact_id, option_id, kind, status, provider)
        VALUES ($1,$2,$3,$4,'booking','queued','twilio')
        RETURNING id
      `,
      [familyId, taskId, contactId, opt1.rows[0].id]
    );
    const voiceJobId = voiceJob.rows[0].id;

    const app = buildServer({ sms, email });

    await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/answer?jobId=${encodeURIComponent(voiceJobId)}&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `CallSid=${encodeURIComponent("CA_BOOK_2")}`
    });

    await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice/gather?jobId=${encodeURIComponent(voiceJobId)}&turn=1&token=${encodeURIComponent(
        process.env.TWILIO_VOICE_WEBHOOK_TOKEN!
      )}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload:
        `CallSid=${encodeURIComponent("CA_BOOK_2")}` + `&SpeechResult=${encodeURIComponent("No")}`
    });

    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0]?.to).toBe(PARENT);
    expect(sms.sent[0]?.body).toContain("couldn’t confirm");

    const taskRow = await pool.query<{ status: string; awaiting_parent: boolean }>(
      "SELECT status, awaiting_parent FROM tasks WHERE id = $1",
      [taskId]
    );
    expect(taskRow.rows[0]?.status).toBe("options_ready");
    expect(taskRow.rows[0]?.awaiting_parent).toBe(true);

    const opts = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM task_options WHERE task_id = $1 ORDER BY rank ASC",
      [taskId]
    );
    expect(opts.rows.find((r) => r.id === opt1.rows[0].id)?.status).toBe("rejected");
    expect(opts.rows.find((r) => r.id === opt2.rows[0].id)?.status).toBe("pending");

    await app.close();
  });
});
