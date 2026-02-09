import { DateTime } from "luxon";
import { withTransaction } from "../db/pool";
import { AppServices } from "../http/buildServer";
import { JOB_COMPILE_SITTER_OPTIONS } from "../jobs/boss";
import { sendAndLogSms } from "./messaging";

export type OfferedSlot = {
  start: Date;
  end: Date;
};

export type HandleInboundVoiceResultArgs = {
  services: AppServices;
  provider: "twilio" | "grok" | "proxy" | "fake";
  providerMessageId: string;
  familyId: string;
  taskId: string;
  contactId: string;
  transcript?: string | null;
  note?: string | null;
  offeredSlots: OfferedSlot[];
  occurredAt: Date;
};

export type HandleInboundVoiceResultResult = {
  ok: true;
  deduped: boolean;
  prompted: boolean;
  scheduledPrompt: boolean;
};

type FamilyRow = {
  id: string;
  assistant_phone_e164: string;
  timezone: string;
};

type ContactRow = {
  id: string;
  name: string;
  voice_opted_out: boolean;
};

type TaskRow = {
  id: string;
  intent_type: string;
  status: string;
  awaiting_parent: boolean;
  metadata: unknown;
};

function safeJson(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj === "object") return obj as Record<string, unknown>;
  return {};
}

async function buildOptionsText(
  taskId: string,
  timezone: string,
  intentType: string
): Promise<string | null> {
  return await withTransaction(async (client) => {
    const optionsRes = await client.query<{
      name: string;
      slot_start: Date;
      slot_end: Date;
      rank: number;
    }>(
      `
        SELECT c.name, o.slot_start, o.slot_end, o.rank
        FROM task_options o
        JOIN contacts c ON c.id = o.contact_id
        WHERE o.task_id = $1 AND o.status = 'pending'
        ORDER BY o.rank ASC
        LIMIT 3
      `,
      [taskId]
    );

    const rows = optionsRes.rows;
    if (rows.length === 0) return null;

    const lines = rows.map((r, i) => {
      const isClinic = intentType === "clinic" || intentType === "therapy";
      const start = DateTime.fromJSDate(r.slot_start, { zone: timezone }).toFormat(
        isClinic ? "ccc L/d h:mma" : "ccc h:mma"
      );
      if (isClinic) return `${i + 1}) ${r.name} (${start})`;
      const end = DateTime.fromJSDate(r.slot_end, { zone: timezone }).toFormat("h:mma");
      return `${i + 1}) ${r.name} (${start}-${end})`;
    });
    return `Options found:\n${lines.join("\n")}\nReply 1-${rows.length}.`;
  });
}

export async function handleInboundVoiceResult(
  args: HandleInboundVoiceResultArgs
): Promise<HandleInboundVoiceResultResult> {
  const { services } = args;

  const summary =
    (args.transcript ?? "").trim() ||
    (args.note ?? "").trim() ||
    `Voice result: ${args.offeredSlots.length} slot(s).`;

  const outcome = await withTransaction(async (client) => {
    const famRes = await client.query<FamilyRow>(
      `
        SELECT id, assistant_phone_e164, timezone
        FROM families
        WHERE id = $1
        FOR UPDATE
      `,
      [args.familyId]
    );
    const family = famRes.rows[0];
    if (!family) return { type: "noop" as const };

    // Dedupe inbound webhook retries.
    const msgInsert = await client.query(
      `
        INSERT INTO message_events (
          family_id, task_id, direction, channel, from_addr, to_addr, body,
          provider, provider_message_id, occurred_at
        ) VALUES ($1,$2,'inbound','voice',$3,$4,$5,$6,$7,$8)
        ON CONFLICT (provider, provider_message_id) DO NOTHING
        RETURNING id
      `,
      [
        family.id,
        args.taskId,
        `contact:${args.contactId}`,
        `family:${family.id}`,
        summary,
        args.provider,
        args.providerMessageId,
        args.occurredAt
      ]
    );
    if (msgInsert.rowCount !== 1) return { type: "deduped" as const };

    const contactRes = await client.query<ContactRow>(
      `
        SELECT id, name, voice_opted_out
        FROM contacts
        WHERE id = $1 AND family_id = $2
        LIMIT 1
      `,
      [args.contactId, family.id]
    );
    const contact = contactRes.rows[0];
    if (!contact) return { type: "noop" as const };
    if (contact.voice_opted_out) return { type: "noop" as const };

    const taskRes = await client.query<TaskRow>(
      `
        SELECT id, intent_type, status, awaiting_parent, metadata
        FROM tasks
        WHERE id = $1 AND family_id = $2
        FOR UPDATE
      `,
      [args.taskId, family.id]
    );
    const task = taskRes.rows[0];
    if (!task) return { type: "noop" as const };
    if (task.status === "confirmed" || task.status === "cancelled" || task.status === "expired") {
      return { type: "noop" as const };
    }

    const slots = args.offeredSlots.slice(0, 3);
    if (slots.length === 0) return { type: "noop" as const };

    const maxRankRes = await client.query<{ max_rank: number }>(
      "SELECT COALESCE(MAX(rank), 0)::int as max_rank FROM task_options WHERE task_id = $1",
      [task.id]
    );
    const baseRank = Number(maxRankRes.rows[0]?.max_rank ?? 0);

    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      await client.query(
        `
          INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
          SELECT $1,$2,$3,$4,'pending',$5
          WHERE NOT EXISTS (
            SELECT 1 FROM task_options
            WHERE task_id = $1 AND contact_id = $2 AND slot_start = $3 AND slot_end = $4
          )
        `,
        [task.id, contact.id, s.start, s.end, baseRank + i + 1]
      );
    }

    const otherAwaitingRes = await client.query<{ id: string }>(
      `
        SELECT id
        FROM tasks
        WHERE family_id = $1 AND awaiting_parent = true AND id <> $2
        LIMIT 1
      `,
      [family.id, task.id]
    );
    const otherAwaiting = otherAwaitingRes.rowCount === 1;

    const meta = safeJson(task.metadata);
    const initiatorPhone = meta.initiatorPhoneE164 as string | undefined;

    const canPrompt = !otherAwaiting && !task.awaiting_parent && !!initiatorPhone;
    if (!canPrompt) {
      return { type: "blocked" as const, taskId: task.id, otherAwaiting };
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
      [task.id]
    );

    return {
      type: "prompt_parent" as const,
      family,
      taskId: task.id,
      intentType: task.intent_type,
      initiatorPhone
    };
  });

  if (outcome.type === "deduped") {
    return { ok: true, deduped: true, prompted: false, scheduledPrompt: false };
  }

  if (outcome.type === "prompt_parent") {
    const optionsText = await buildOptionsText(outcome.taskId, outcome.family.timezone, outcome.intentType);
    if (optionsText) {
      await sendAndLogSms({
        services,
        familyId: outcome.family.id,
        taskId: outcome.taskId,
        from: outcome.family.assistant_phone_e164,
        to: outcome.initiatorPhone,
        body: optionsText,
        occurredAt: args.occurredAt
      });
      return { ok: true, deduped: false, prompted: true, scheduledPrompt: false };
    }
    return { ok: true, deduped: false, prompted: false, scheduledPrompt: false };
  }

  if (outcome.type === "blocked") {
    // If we couldn't prompt (usually because another task is awaiting a parent reply),
    // schedule a later attempt to compile and prompt.
    if (services.boss) {
      await services.boss.send(
        JOB_COMPILE_SITTER_OPTIONS,
        { taskId: outcome.taskId },
        { startAfter: DateTime.utc().plus({ minutes: 5 }).toJSDate() }
      );
      return { ok: true, deduped: false, prompted: false, scheduledPrompt: true };
    }
    return { ok: true, deduped: false, prompted: false, scheduledPrompt: false };
  }

  return { ok: true, deduped: false, prompted: false, scheduledPrompt: false };
}
