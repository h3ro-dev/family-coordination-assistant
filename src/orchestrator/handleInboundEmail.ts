import { DateTime } from "luxon";
import { AppServices } from "../http/buildServer";
import { withTransaction } from "../db/pool";
import { parseYesNo } from "../domain/parsing/parseYesNo";
import { sendAndLogEmail, sendAndLogSms } from "./messaging";

export type HandleInboundEmailArgs = {
  services: AppServices;
  provider: "resend" | "proxy" | "fake";
  providerMessageId: string;
  familyId: string;
  fromEmail: string;
  toEmail: string;
  text: string;
  occurredAt: Date;
};

type FamilyRow = {
  id: string;
  assistant_phone_e164: string;
  timezone: string;
};

type ContactRow = {
  id: string;
  email: string | null;
  email_opted_out: boolean;
  name: string;
};

type TaskRow = {
  id: string;
  status: string;
  requested_start: Date | null;
  requested_end: Date | null;
  awaiting_parent: boolean;
  metadata: unknown;
};

function isStopMessage(text: string): boolean {
  return text.trim().toLowerCase() === "stop";
}

function isStartMessage(text: string): boolean {
  return text.trim().toLowerCase() === "start";
}

function safeJson(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj === "object") return obj as Record<string, unknown>;
  return {};
}

export async function handleInboundEmail(args: HandleInboundEmailArgs): Promise<void> {
  const { services } = args;

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

    const msgInsert = await client.query(
      `
        INSERT INTO message_events (
          family_id, direction, channel, from_addr, to_addr, body,
          provider, provider_message_id, occurred_at
        ) VALUES ($1,'inbound','email',$2,$3,$4,$5,$6,$7)
        ON CONFLICT (provider, provider_message_id) DO NOTHING
        RETURNING id
      `,
      [
        family.id,
        args.fromEmail,
        args.toEmail,
        args.text,
        args.provider,
        args.providerMessageId,
        args.occurredAt
      ]
    );
    if (msgInsert.rowCount !== 1) return { type: "noop" as const };

    const contactRes = await client.query<ContactRow>(
      `
        SELECT id, email, email_opted_out, name
        FROM contacts
        WHERE family_id = $1 AND lower(email) = lower($2)
        LIMIT 1
      `,
      [family.id, args.fromEmail]
    );
    const contact = contactRes.rows[0];
    if (!contact) return { type: "noop" as const };

    if (isStopMessage(args.text)) {
      await client.query(
        "UPDATE contacts SET email_opted_out = true, updated_at = now() WHERE id = $1",
        [contact.id]
      );
      return { type: "email_stop" as const, family, taskId: null as string | null, contact };
    }

    if (isStartMessage(args.text)) {
      await client.query(
        "UPDATE contacts SET email_opted_out = false, updated_at = now() WHERE id = $1",
        [contact.id]
      );
      return { type: "email_start" as const, family, taskId: null as string | null, contact };
    }

    if (contact.email_opted_out) return { type: "noop" as const };

    const taskRes = await client.query<TaskRow>(
      `
        SELECT
          t.id, t.status, t.requested_start, t.requested_end, t.awaiting_parent, t.metadata
        FROM tasks t
        JOIN task_outreach o ON o.task_id = t.id AND o.contact_id = $2
        LEFT JOIN task_contact_responses r ON r.task_id = t.id AND r.contact_id = $2
        WHERE t.family_id = $1
          AND t.status = 'collecting'
          AND r.id IS NULL
        ORDER BY t.created_at DESC
        LIMIT 1
      `,
      [family.id, contact.id]
    );
    const task = taskRes.rows[0];
    if (!task) return { type: "noop" as const };

    const yesNo = parseYesNo(args.text);
    await client.query(
      `
        INSERT INTO task_contact_responses (task_id, contact_id, response, message_event_id)
        VALUES ($1,$2,$3,NULL)
        ON CONFLICT (task_id, contact_id) DO NOTHING
      `,
      [task.id, contact.id, yesNo]
    );

    if (yesNo === "unknown") {
      return { type: "clarify" as const, family, contact, taskId: task.id };
    }

    if (yesNo === "yes") {
      const rankRes = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM task_options WHERE task_id = $1",
        [task.id]
      );
      const rank = Number(rankRes.rows[0]?.count ?? "0") + 1;

      await client.query(
        `
          INSERT INTO task_options (task_id, contact_id, slot_start, slot_end, status, rank)
          SELECT $1,$2,$3,$4,'pending',$5
          WHERE NOT EXISTS (
            SELECT 1 FROM task_options WHERE task_id = $1 AND contact_id = $2
          )
        `,
        [task.id, contact.id, task.requested_start, task.requested_end, rank]
      );
    }

    const otherAwaitingRes = await client.query<{ id: string }>(
      `
        SELECT id FROM tasks
        WHERE family_id = $1 AND awaiting_parent = true AND id <> $2
        LIMIT 1
      `,
      [family.id, task.id]
    );
    const otherAwaiting = otherAwaitingRes.rowCount === 1;

    const outreachCountRes = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM task_outreach WHERE task_id = $1",
      [task.id]
    );
    const responseCountRes = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM task_contact_responses WHERE task_id = $1",
      [task.id]
    );
    const yesCountRes = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM task_options WHERE task_id = $1 AND status = 'pending'",
      [task.id]
    );

    const outreachCount = Number(outreachCountRes.rows[0]?.count ?? "0");
    const responseCount = Number(responseCountRes.rows[0]?.count ?? "0");
    const yesCount = Number(yesCountRes.rows[0]?.count ?? "0");

    const shouldPrompt = yesCount >= 3 || (responseCount >= outreachCount && yesCount > 0);

    if (shouldPrompt && !task.awaiting_parent && !otherAwaiting) {
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
      return { type: "prompt_parent" as const, family, taskId: task.id, metadata: task.metadata };
    }

    return { type: "noop" as const };
  });

  if (outcome.type === "noop") return;

  if (outcome.type === "email_stop") {
    if (!outcome.contact.email) return;
    await sendAndLogEmail({
      services,
      familyId: outcome.family.id,
      taskId: outcome.taskId ?? undefined,
      to: outcome.contact.email,
      subject: "Opted out",
      text: "You're opted out of email messages. Reply START to re-subscribe.",
      occurredAt: args.occurredAt
    });
    return;
  }

  if (outcome.type === "email_start") {
    if (!outcome.contact.email) return;
    await sendAndLogEmail({
      services,
      familyId: outcome.family.id,
      taskId: outcome.taskId ?? undefined,
      to: outcome.contact.email,
      subject: "Re-subscribed",
      text: "You're re-subscribed for email messages. Reply STOP to opt out.",
      occurredAt: args.occurredAt
    });
    return;
  }

  if (outcome.type === "clarify") {
    if (!outcome.contact.email) return;
    await sendAndLogEmail({
      services,
      familyId: outcome.family.id,
      taskId: outcome.taskId,
      to: outcome.contact.email,
      subject: "Quick reply needed",
      text: "Quick reply: YES or NO?",
      occurredAt: args.occurredAt
    });
    return;
  }

  if (outcome.type === "prompt_parent") {
    const optionsText = await withTransaction(async (client) => {
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
        [outcome.taskId]
      );

      const rows = optionsRes.rows;
      if (rows.length === 0) return null;

      const lines = rows.map((r, i) => {
        const start = DateTime.fromJSDate(r.slot_start, { zone: outcome.family.timezone }).toFormat(
          "ccc h:mma"
        );
        const end = DateTime.fromJSDate(r.slot_end, { zone: outcome.family.timezone }).toFormat(
          "h:mma"
        );
        return `${i + 1}) ${r.name} (${start}-${end})`;
      });
      return `Options found:\n${lines.join("\n")}\nReply 1-${rows.length}.`;
    });
    if (!optionsText) return;

    const meta = safeJson(outcome.metadata);
    const initiatorPhone = meta.initiatorPhoneE164 as string | undefined;
    if (!initiatorPhone) return;

    await sendAndLogSms({
      services,
      familyId: outcome.family.id,
      taskId: outcome.taskId,
      from: outcome.family.assistant_phone_e164,
      to: initiatorPhone,
      body: optionsText,
      occurredAt: args.occurredAt
    });
  }
}
