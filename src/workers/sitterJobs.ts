import { DateTime } from "luxon";
import { withTransaction } from "../db/pool";
import { AppServices } from "../http/buildServer";
import { sendAndLogSms } from "../orchestrator/messaging";
import { JOB_COMPILE_SITTER_OPTIONS } from "../jobs/boss";

type FamilyTaskRow = {
  task_id: string;
  family_id: string;
  assistant_phone_e164: string;
  timezone: string;
  status: string;
  awaiting_parent: boolean;
  requested_start: Date | null;
  requested_end: Date | null;
  metadata: unknown;
};

function safeJson(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj === "object") return obj as Record<string, unknown>;
  return {};
}

export async function compileSitterOptions(
  services: AppServices,
  taskId: string
): Promise<void> {
  const outcome = await withTransaction(async (client) => {
    const res = await client.query<FamilyTaskRow>(
      `
        SELECT
          t.id as task_id,
          t.family_id,
          f.assistant_phone_e164,
          f.timezone,
          t.status,
          t.awaiting_parent,
          t.requested_start,
          t.requested_end,
          t.metadata
        FROM tasks t
        JOIN families f ON f.id = t.family_id
        WHERE t.id = $1
        FOR UPDATE
      `,
      [taskId]
    );
    const row = res.rows[0];
    if (!row) return { type: "noop" as const };
    if (row.status !== "collecting") return { type: "noop" as const };
    if (row.awaiting_parent) return { type: "noop" as const };

    const otherAwaitingRes = await client.query<{ id: string }>(
      `
        SELECT id FROM tasks
        WHERE family_id = $1 AND awaiting_parent = true AND id <> $2
        LIMIT 1
      `,
      [row.family_id, row.task_id]
    );
    if (otherAwaitingRes.rowCount === 1) return { type: "noop" as const };

    const optionsRes = await client.query<{
      name: string;
      phone_e164: string | null;
      slot_start: Date;
      slot_end: Date;
      rank: number;
    }>(
      `
        SELECT c.name, c.phone_e164, o.slot_start, o.slot_end, o.rank
        FROM task_options o
        JOIN contacts c ON c.id = o.contact_id
        WHERE o.task_id = $1 AND o.status = 'pending'
        ORDER BY o.rank ASC
        LIMIT 3
      `,
      [row.task_id]
    );

    const options = optionsRes.rows;
    if (options.length === 0) {
      return { type: "no_options" as const, row };
    }

    await client.query(
      `
        UPDATE tasks
        SET status = 'options_ready',
            awaiting_parent = true,
            awaiting_parent_reason = 'choose_option',
            updated_at = now()
        WHERE id = $1
      `,
      [row.task_id]
    );

    return { type: "prompt" as const, row, options };
  });

  if (outcome.type === "noop") return;

  const meta = safeJson(outcome.row.metadata);
  const initiatorPhone = meta.initiatorPhoneE164 as string | undefined;
  if (!initiatorPhone) return;

  if (outcome.type === "no_options") {
    await sendAndLogSms({
      services,
      familyId: outcome.row.family_id,
      taskId: outcome.row.task_id,
      from: outcome.row.assistant_phone_e164,
      to: initiatorPhone,
      body: "No one has replied yet. I’ll try again tomorrow.",
      occurredAt: new Date()
    });
    return;
  }

  const lines = outcome.options.map((o, i) => {
    const start = DateTime.fromJSDate(o.slot_start, { zone: outcome.row.timezone }).toFormat(
      "ccc h:mma"
    );
    const end = DateTime.fromJSDate(o.slot_end, { zone: outcome.row.timezone }).toFormat("h:mma");
    return `${i + 1}) ${o.name} (${start}-${end})`;
  });

  const body = `Options found:\n${lines.join("\n")}\nReply 1-${outcome.options.length}.`;

  await sendAndLogSms({
    services,
    familyId: outcome.row.family_id,
    taskId: outcome.row.task_id,
    from: outcome.row.assistant_phone_e164,
    to: initiatorPhone,
    body,
    occurredAt: new Date()
  });
}

export async function retrySitterOutreach(
  services: AppServices,
  taskId: string
): Promise<void> {
  const outcome = await withTransaction(async (client) => {
    const res = await client.query<FamilyTaskRow>(
      `
        SELECT
          t.id as task_id,
          t.family_id,
          f.assistant_phone_e164,
          f.timezone,
          t.status,
          t.awaiting_parent,
          t.requested_start,
          t.requested_end,
          t.metadata
        FROM tasks t
        JOIN families f ON f.id = t.family_id
        WHERE t.id = $1
        FOR UPDATE
      `,
      [taskId]
    );
    const row = res.rows[0];
    if (!row) return { type: "noop" as const };
    if (row.status !== "collecting") return { type: "noop" as const };
    if (!row.requested_start || !row.requested_end) return { type: "noop" as const };

    const targetsRes = await client.query<{ phone_e164: string }>(
      `
        SELECT c.phone_e164
        FROM task_outreach o
        JOIN contacts c ON c.id = o.contact_id
        LEFT JOIN task_contact_responses r
          ON r.task_id = o.task_id AND r.contact_id = o.contact_id
        WHERE o.task_id = $1
          AND o.channel = 'sms'
          AND c.sms_opted_out = false
          AND c.phone_e164 IS NOT NULL
          AND r.id IS NULL
      `,
      [row.task_id]
    );

    const targets = targetsRes.rows.map((r) => r.phone_e164);
    if (targets.length === 0) return { type: "noop" as const };

    return { type: "retry" as const, row, targets };
  });

  if (outcome.type !== "retry") return;

  const start = DateTime.fromJSDate(outcome.row.requested_start as Date, {
    zone: outcome.row.timezone
  }).toFormat("ccc L/d h:mma");
  const end = DateTime.fromJSDate(outcome.row.requested_end as Date, {
    zone: outcome.row.timezone
  }).toFormat("h:mma");

  for (const phone of outcome.targets) {
    await sendAndLogSms({
      services,
      familyId: outcome.row.family_id,
      taskId: outcome.row.task_id,
      from: outcome.row.assistant_phone_e164,
      to: phone,
      body: `Quick check: are you available ${start}-${end}? Reply YES or NO.`,
      occurredAt: new Date()
    });
  }

  // Re-run compilation in 30 minutes.
  if (services.boss) {
    await services.boss.send(JOB_COMPILE_SITTER_OPTIONS, { taskId }, {
      startAfter: DateTime.utc().plus({ minutes: 30 }).toJSDate()
    });
  }
}
