import { DateTime } from "luxon";
import { AppServices } from "../http/buildServer";
import { withTransaction } from "../db/pool";
import { isSitterIntent, parseSitterRequest } from "../domain/parsing/parseSitterRequest";
import { parseContactList } from "../domain/parsing/parseContactList";
import { parseYesNo } from "../domain/parsing/parseYesNo";
import { JOB_COMPILE_SITTER_OPTIONS, JOB_RETRY_SITTER_OUTREACH } from "../jobs/boss";
import { sendAndLogSms } from "./messaging";
import { parseTimeWindow } from "../domain/parsing/parseTimeWindow";

export type HandleInboundSmsArgs = {
  services: AppServices;
  provider: "twilio" | "fake";
  providerMessageId: string;
  from: string;
  to: string;
  text: string;
  occurredAt: Date;
};

type FamilyRow = {
  id: string;
  assistant_phone_e164: string;
  display_name: string;
  timezone: string;
};

type TaskRow = {
  id: string;
  intent_type: string;
  status: string;
  requested_start: Date | null;
  requested_end: Date | null;
  awaiting_parent: boolean;
  awaiting_parent_reason: string | null;
  metadata: unknown;
};

type ContactRow = {
  id: string;
  name: string;
  phone_e164: string | null;
  sms_opted_out: boolean;
};

function isStopMessage(text: string): boolean {
  return text.trim().toLowerCase() === "stop";
}

function isStartMessage(text: string): boolean {
  return text.trim().toLowerCase() === "start";
}

function isCancelMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "cancel" || t === "cancel task" || t === "never mind";
}

function isStatusMessage(text: string): boolean {
  return text.trim().toLowerCase() === "status";
}

function safeJson(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj === "object") return obj as Record<string, unknown>;
  return {};
}

function parseChoice(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function handleInboundSms(args: HandleInboundSmsArgs): Promise<void> {
  const { services } = args;

  const outcome = await withTransaction(async (client) => {
    // Lock the family row so messages are processed sequentially per family.
    const famRes = await client.query<FamilyRow>(
      `
        SELECT id, assistant_phone_e164, display_name, timezone
        FROM families
        WHERE assistant_phone_e164 = $1
        FOR UPDATE
      `,
      [args.to]
    );
    const family = famRes.rows[0];
    if (!family) return { type: "noop" as const };

    // Dedupe inbound webhook retries.
    const msgInsert = await client.query(
      `
        INSERT INTO message_events (
          family_id, direction, channel, from_addr, to_addr, body,
          provider, provider_message_id, occurred_at
        ) VALUES ($1,'inbound','sms',$2,$3,$4,$5,$6,$7)
        ON CONFLICT (provider, provider_message_id) DO NOTHING
        RETURNING id
      `,
      [
        family.id,
        args.from,
        args.to,
        args.text,
        args.provider,
        args.providerMessageId,
        args.occurredAt
      ]
    );
    const inserted = msgInsert.rowCount === 1;
    if (!inserted) return { type: "noop" as const };

    // Is this an authorized parent phone?
    const authRes = await client.query<{ id: string }>(
      `
        SELECT id FROM family_authorized_phones
        WHERE family_id = $1 AND phone_e164 = $2
        LIMIT 1
      `,
      [family.id, args.from]
    );
    const isParent = authRes.rowCount === 1;

    if (!isParent) {
      // Contact path (e.g., sitter replies).
      const contactRes = await client.query<ContactRow>(
        `
          SELECT id, name, phone_e164, sms_opted_out
          FROM contacts
          WHERE family_id = $1 AND phone_e164 = $2
          LIMIT 1
        `,
        [family.id, args.from]
      );
      const contact = contactRes.rows[0];
      if (!contact) return { type: "noop" as const };

      if (isStopMessage(args.text)) {
        await client.query(
          "UPDATE contacts SET sms_opted_out = true, updated_at = now() WHERE id = $1",
          [contact.id]
        );
        return {
          type: "send_sms" as const,
          family,
          to: contact.phone_e164 ?? args.from,
          from: family.assistant_phone_e164,
          body: "You’re opted out. Reply START to re-subscribe."
        };
      }

      if (isStartMessage(args.text)) {
        await client.query(
          "UPDATE contacts SET sms_opted_out = false, updated_at = now() WHERE id = $1",
          [contact.id]
        );
        return {
          type: "send_sms" as const,
          family,
          to: contact.phone_e164 ?? args.from,
          from: family.assistant_phone_e164,
          body: "You’re re-subscribed. Reply STOP to opt out."
        };
      }

      if (contact.sms_opted_out) return { type: "noop" as const };

      const taskRes = await client.query<TaskRow>(
        `
          SELECT
            t.id, t.intent_type, t.status, t.requested_start, t.requested_end,
            t.awaiting_parent, t.awaiting_parent_reason, t.metadata
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
        return {
          type: "send_sms" as const,
          family,
          to: contact.phone_e164 ?? args.from,
          from: family.assistant_phone_e164,
          body: "Quick reply: YES or NO?"
        };
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
          [
            task.id,
            contact.id,
            task.requested_start,
            task.requested_end,
            rank
          ]
        );
      }

      // Decide whether to prompt the parent now.
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

      const shouldPrompt =
        (yesCount >= 3) || (responseCount >= outreachCount && yesCount > 0);

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

        return { type: "prompt_parent_options" as const, family, taskId: task.id };
      }

      return { type: "noop" as const };
    }

    // Parent path.
    const awaitingRes = await client.query<TaskRow>(
      `
        SELECT
          id, intent_type, status, requested_start, requested_end,
          awaiting_parent, awaiting_parent_reason, metadata
        FROM tasks
        WHERE family_id = $1 AND awaiting_parent = true
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [family.id]
    );
    const awaitingTask = awaitingRes.rows[0];

    if (isCancelMessage(args.text)) {
      const target = awaitingTask
        ? { id: awaitingTask.id, intent_type: awaitingTask.intent_type, status: awaitingTask.status }
        : await (async () => {
            const res = await client.query<{ id: string; intent_type: string; status: string }>(
              `
                SELECT id, intent_type, status
                FROM tasks
                WHERE family_id = $1 AND status NOT IN ('confirmed','cancelled','expired')
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
              `,
              [family.id]
            );
            return res.rows[0] ?? null;
          })();

      if (!target) {
        return {
          type: "send_sms" as const,
          family,
          to: args.from,
          from: family.assistant_phone_e164,
          body: "No active request to cancel."
        };
      }

      await client.query(
        `
          UPDATE tasks
          SET status = 'cancelled',
              awaiting_parent = false,
              awaiting_parent_reason = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [target.id]
      );

      return {
        type: "send_sms" as const,
        family,
        to: args.from,
        from: family.assistant_phone_e164,
        body: `Cancelled (${target.intent_type}).`
      };
    }

    if (isStatusMessage(args.text)) {
      const res = await client.query<{ intent_type: string; status: string; awaiting_parent: boolean }>(
        `
          SELECT intent_type, status, awaiting_parent
          FROM tasks
          WHERE family_id = $1 AND status NOT IN ('confirmed','cancelled','expired')
          ORDER BY created_at DESC
          LIMIT 5
        `,
        [family.id]
      );

      if (res.rows.length === 0) {
        return {
          type: "send_sms" as const,
          family,
          to: args.from,
          from: family.assistant_phone_e164,
          body: "No active requests."
        };
      }

      const lines = res.rows.map(
        (r, i) => `${i + 1}) ${r.intent_type}: ${r.status}${r.awaiting_parent ? " (needs your reply)" : ""}`
      );
      return {
        type: "send_sms" as const,
        family,
        to: args.from,
        from: family.assistant_phone_e164,
        body: `Active requests:\n${lines.join("\n")}`
      };
    }

    if (awaitingTask) {
      if (awaitingTask.awaiting_parent_reason === "need_time_window") {
        const now = DateTime.fromJSDate(args.occurredAt, { zone: family.timezone });
        const parsedWindow = parseTimeWindow(args.text, now);
        if (!parsedWindow) {
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: "What day and time? Reply like: 'Fri 6-10'."
          };
        }

        // Save the time window, then proceed like a sitter task.
        await client.query(
          `
            UPDATE tasks
            SET requested_start = $2,
                requested_end = $3,
                parsed_at = now(),
                updated_at = now()
            WHERE id = $1
          `,
          [awaitingTask.id, parsedWindow.start.toJSDate(), parsedWindow.end.toJSDate()]
        );

        const sittersRes = await client.query<ContactRow>(
          `
            SELECT id, name, phone_e164, sms_opted_out
            FROM contacts
            WHERE family_id = $1 AND category = 'sitter'
              AND phone_e164 IS NOT NULL
              AND sms_opted_out = false
            ORDER BY created_at ASC
          `,
          [family.id]
        );
        const sitters = sittersRes.rows;

        if (sitters.length === 0) {
          await client.query(
            `
              UPDATE tasks
              SET awaiting_parent = true,
                  awaiting_parent_reason = 'need_contacts',
                  updated_at = now()
              WHERE id = $1
            `,
            [awaitingTask.id]
          );
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: "No sitters saved yet. Reply with sitter name + number (e.g., 'Sarah 801-555-1234')."
          };
        }

        const outreachTargets = sitters.slice(0, 8).filter((s) => s.phone_e164);
        for (const s of outreachTargets) {
          await client.query(
            `
              INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
              VALUES ($1,$2,'sms',NULL,'queued')
              ON CONFLICT (task_id, contact_id, channel) DO NOTHING
            `,
            [awaitingTask.id, s.id]
          );
        }

        await client.query(
          `
            UPDATE tasks
            SET status = 'collecting',
                awaiting_parent = false,
                awaiting_parent_reason = NULL,
                updated_at = now()
            WHERE id = $1
          `,
          [awaitingTask.id]
        );

        return {
          type: "start_outreach" as const,
          family,
          taskId: awaitingTask.id,
          requestedStart: parsedWindow.start.toJSDate(),
          requestedEnd: parsedWindow.end.toJSDate(),
          contacts: outreachTargets.map((c) => ({ id: c.id, phoneE164: c.phone_e164 as string })),
          ackToParent: true
        };
      }

      if (awaitingTask.awaiting_parent_reason === "need_contacts") {
        const parsed = parseContactList(args.text, "US");
        if (parsed.length === 0) {
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: "Reply with sitter name + number, e.g. 'Sarah 801-555-1234; Jenna 801-555-4567'."
          };
        }

        const createdContacts: { id: string; phone_e164: string }[] = [];
        for (const c of parsed) {
          const existing = await client.query<{ id: string; phone_e164: string }>(
            `
              SELECT id, phone_e164
              FROM contacts
              WHERE family_id = $1 AND phone_e164 = $2
              LIMIT 1
            `,
            [family.id, c.phoneE164]
          );
          if (existing.rowCount === 1) {
            createdContacts.push(existing.rows[0]);
            continue;
          }

          const ins = await client.query<{ id: string; phone_e164: string }>(
            `
              INSERT INTO contacts (family_id, name, category, phone_e164, channel_pref)
              VALUES ($1,$2,'sitter',$3,'sms')
              RETURNING id, phone_e164
            `,
            [family.id, c.name, c.phoneE164]
          );
          createdContacts.push(ins.rows[0]);
        }

        // Send outreach to newly added sitters.
        for (const c of createdContacts) {
          await client.query(
            `
              INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
              VALUES ($1,$2,'sms',NULL,'queued')
              ON CONFLICT (task_id, contact_id, channel) DO NOTHING
            `,
            [awaitingTask.id, c.id]
          );
        }

        await client.query(
          `
            UPDATE tasks
            SET status = 'collecting',
                awaiting_parent = false,
                awaiting_parent_reason = NULL,
                updated_at = now()
            WHERE id = $1
          `,
          [awaitingTask.id]
        );

        return {
          type: "start_outreach" as const,
          family,
          taskId: awaitingTask.id,
          requestedStart: awaitingTask.requested_start,
          requestedEnd: awaitingTask.requested_end,
          contacts: createdContacts.map((c) => ({ id: c.id, phoneE164: c.phone_e164 }))
        };
      }

      if (awaitingTask.awaiting_parent_reason === "choose_option") {
        const choice = parseChoice(args.text);
        if (!choice) {
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: "Reply with a number (1, 2, or 3) so I don’t mix up requests."
          };
        }

        const optionsRes = await client.query<{
          option_id: string;
          contact_id: string;
          name: string;
          phone_e164: string | null;
          slot_start: Date;
          slot_end: Date;
          rank: number;
        }>(
          `
            SELECT
              o.id as option_id,
              c.id as contact_id,
              c.name,
              c.phone_e164,
              o.slot_start,
              o.slot_end,
              o.rank
            FROM task_options o
            JOIN contacts c ON c.id = o.contact_id
            WHERE o.task_id = $1 AND o.status = 'pending'
            ORDER BY o.rank ASC
            LIMIT 3
          `,
          [awaitingTask.id]
        );
        const options = optionsRes.rows;
        if (options.length === 0) {
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: "No options are ready yet. I’m still waiting on replies."
          };
        }

        if (choice < 1 || choice > options.length) {
          return {
            type: "send_sms" as const,
            family,
            to: args.from,
            from: family.assistant_phone_e164,
            body: `Reply 1-${options.length}.`
          };
        }

        const selected = options[choice - 1];

        await client.query(
          "UPDATE task_options SET status = 'selected' WHERE id = $1",
          [selected.option_id]
        );
        await client.query(
          "UPDATE task_options SET status = 'rejected' WHERE task_id = $1 AND id <> $2 AND status = 'pending'",
          [awaitingTask.id, selected.option_id]
        );

        await client.query(
          `
            UPDATE tasks
            SET status = 'confirmed',
                awaiting_parent = false,
                awaiting_parent_reason = NULL,
                updated_at = now()
            WHERE id = $1
          `,
          [awaitingTask.id]
        );

        return {
          type: "confirm_selection" as const,
          family,
          taskId: awaitingTask.id,
          selectedContact: {
            id: selected.contact_id,
            name: selected.name,
            phoneE164: selected.phone_e164
          },
          rejectedContacts: options
            .filter((o) => o.option_id !== selected.option_id)
            .map((o) => ({ id: o.contact_id, name: o.name, phoneE164: o.phone_e164 })),
          slotStart: selected.slot_start,
          slotEnd: selected.slot_end
        };
      }

      return { type: "noop" as const };
    }

    // No awaiting task; treat as new request.
    const activeCountRes = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text as count
        FROM tasks
        WHERE family_id = $1 AND status NOT IN ('confirmed','cancelled','expired')
      `,
      [family.id]
    );
    const activeCount = Number(activeCountRes.rows[0]?.count ?? "0");
    if (activeCount >= 5) {
      return {
        type: "send_sms" as const,
        family,
        to: args.from,
        from: family.assistant_phone_e164,
        body: "I can handle up to 5 active requests at a time. Finish or cancel one, then text me again."
      };
    }

    const now = DateTime.fromJSDate(args.occurredAt, { zone: family.timezone });
    const parsed = parseSitterRequest(args.text, now);
    if (!parsed) {
      if (isSitterIntent(args.text)) {
        const metadata = { initiatorPhoneE164: args.from, originalText: args.text };
        const taskIns = await client.query<{ id: string }>(
          `
            INSERT INTO tasks (
              family_id, intent_type, status,
              awaiting_parent, awaiting_parent_reason, metadata
            ) VALUES ($1,'sitter','intent_created',true,'need_time_window',$2::jsonb)
            RETURNING id
          `,
          [family.id, JSON.stringify(metadata)]
        );

        return {
          type: "send_sms" as const,
          family,
          taskId: taskIns.rows[0].id,
          to: args.from,
          from: family.assistant_phone_e164,
          body: "What day and time? Reply like: 'Fri 6-10'."
        };
      }

      return {
        type: "send_sms" as const,
        family,
        to: args.from,
        from: family.assistant_phone_e164,
        body: "For now I can help with sitters. Text like: 'Find a sitter Friday 6-10'."
      };
    }

    const sittersRes = await client.query<ContactRow>(
      `
        SELECT id, name, phone_e164, sms_opted_out
        FROM contacts
        WHERE family_id = $1 AND category = 'sitter'
          AND phone_e164 IS NOT NULL
          AND sms_opted_out = false
        ORDER BY created_at ASC
      `,
      [family.id]
    );
    const sitters = sittersRes.rows;

    const metadata = { initiatorPhoneE164: args.from };

    if (sitters.length === 0) {
      const taskIns = await client.query<{ id: string }>(
        `
          INSERT INTO tasks (
            family_id, intent_type, status, requested_start, requested_end,
            awaiting_parent, awaiting_parent_reason, parsed_at, metadata
          ) VALUES ($1,'sitter','intent_created',$2,$3,true,'need_contacts',now(),$4::jsonb)
          RETURNING id
        `,
        [family.id, parsed.start.toJSDate(), parsed.end.toJSDate(), JSON.stringify(metadata)]
      );

      return {
        type: "send_sms" as const,
        family,
        taskId: taskIns.rows[0].id,
        to: args.from,
        from: family.assistant_phone_e164,
        body: "No sitters saved yet. Reply with sitter name + number (e.g., 'Sarah 801-555-1234')."
      };
    }

    // Create task + outreach records.
    const taskIns = await client.query<{ id: string }>(
      `
        INSERT INTO tasks (
          family_id, intent_type, status, requested_start, requested_end,
          awaiting_parent, awaiting_parent_reason, parsed_at, metadata
        ) VALUES ($1,'sitter','collecting',$2,$3,false,NULL,now(),$4::jsonb)
        RETURNING id
      `,
      [family.id, parsed.start.toJSDate(), parsed.end.toJSDate(), JSON.stringify(metadata)]
    );
    const taskId = taskIns.rows[0].id;

    const outreachTargets = sitters.slice(0, 8).filter((s) => s.phone_e164);
    for (const s of outreachTargets) {
      await client.query(
        `
          INSERT INTO task_outreach (task_id, contact_id, channel, sent_at, status)
          VALUES ($1,$2,'sms',NULL,'queued')
          ON CONFLICT (task_id, contact_id, channel) DO NOTHING
        `,
        [taskId, s.id]
      );
    }

    return {
      type: "start_outreach" as const,
      family,
      taskId,
      requestedStart: parsed.start.toJSDate(),
      requestedEnd: parsed.end.toJSDate(),
      contacts: outreachTargets.map((c) => ({
        id: c.id,
        phoneE164: c.phone_e164 as string
      })),
      ackToParent: true
    };
  });

  if (outcome.type === "noop") return;

  if (outcome.type === "send_sms") {
    await sendAndLogSms({
      services,
      familyId: outcome.family.id,
      taskId: "taskId" in outcome ? (outcome.taskId as string) : undefined,
      from: outcome.from,
      to: outcome.to,
      body: outcome.body,
      occurredAt: args.occurredAt
    });
    return;
  }

  if (outcome.type === "start_outreach") {
    const taskId = outcome.taskId;

    if (outcome.ackToParent) {
      await sendAndLogSms({
        services,
        familyId: outcome.family.id,
        taskId,
        from: outcome.family.assistant_phone_e164,
        to: args.from,
        body: "Got it. Asking your sitters now.",
        occurredAt: args.occurredAt
      });
    } else {
      await sendAndLogSms({
        services,
        familyId: outcome.family.id,
        taskId,
        from: outcome.family.assistant_phone_e164,
        to: args.from,
        body: "Saved. Asking them now.",
        occurredAt: args.occurredAt
      });
    }

    const slotStart = outcome.requestedStart;
    const slotEnd = outcome.requestedEnd;
    if (!slotStart || !slotEnd) {
      await sendAndLogSms({
        services,
        familyId: outcome.family.id,
        taskId,
        from: outcome.family.assistant_phone_e164,
        to: args.from,
        body: "I lost the requested time window. Please resend your request like: 'Find a sitter Friday 6-10'.",
        occurredAt: args.occurredAt
      });
      return;
    }

    for (const c of outcome.contacts) {
      const msg = `Hi! Are you available to babysit from ${DateTime.fromJSDate(
        slotStart,
        { zone: outcome.family.timezone }
      ).toFormat("ccc L/d h:mma")} to ${DateTime.fromJSDate(slotEnd, {
        zone: outcome.family.timezone
      })
        .toFormat("h:mma")}? Reply YES or NO.`;
      await sendAndLogSms({
        services,
        familyId: outcome.family.id,
        taskId,
        from: outcome.family.assistant_phone_e164,
        to: c.phoneE164,
        body: msg,
        occurredAt: args.occurredAt
      });
    }

    // Compile options after 20 minutes if we haven't already.
    if (services.boss) {
      await services.boss.send(
        JOB_COMPILE_SITTER_OPTIONS,
        { taskId },
        { startAfter: DateTime.utc().plus({ minutes: 20 }).toJSDate() }
      );
      await services.boss.send(
        JOB_RETRY_SITTER_OUTREACH,
        { taskId },
        { startAfter: DateTime.utc().plus({ hours: 24 }).toJSDate() }
      );
    }

    // Mark outreach as sent.
    await withTransaction(async (client) => {
      await client.query(
        "UPDATE task_outreach SET status = 'sent', sent_at = now() WHERE task_id = $1 AND status = 'queued'",
        [taskId]
      );
    });

    return;
  }

  if (outcome.type === "prompt_parent_options") {
    const { family, taskId } = outcome;
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
        [taskId]
      );

      const rows = optionsRes.rows;
      if (rows.length === 0) return null;

      const lines = rows.map((r, i) => {
        const start = DateTime.fromJSDate(r.slot_start, { zone: family.timezone }).toFormat(
          "ccc h:mma"
        );
        const end = DateTime.fromJSDate(r.slot_end, { zone: family.timezone }).toFormat("h:mma");
        return `${i + 1}) ${r.name} (${start}-${end})`;
      });
      return `Options found:\n${lines.join("\n")}\nReply 1-${rows.length}.`;
    });

    if (!optionsText) return;

    const metaRes = await withTransaction(async (client) => {
      const taskRes = await client.query<{ metadata: unknown }>(
        "SELECT metadata FROM tasks WHERE id = $1",
        [taskId]
      );
      return taskRes.rows[0]?.metadata;
    });
    const meta = safeJson(metaRes);
    const initiatorPhone = (meta.initiatorPhoneE164 as string | undefined) ?? args.from;

    await sendAndLogSms({
      services,
      familyId: family.id,
      taskId,
      from: family.assistant_phone_e164,
      to: initiatorPhone,
      body: optionsText,
      occurredAt: args.occurredAt
    });
    return;
  }

  if (outcome.type === "confirm_selection") {
    const { family, taskId } = outcome;

    await sendAndLogSms({
      services,
      familyId: family.id,
      taskId,
      from: family.assistant_phone_e164,
      to: args.from,
      body: `Confirmed: ${outcome.selectedContact.name}.`,
      occurredAt: args.occurredAt
    });

    if (outcome.selectedContact.phoneE164) {
      await sendAndLogSms({
        services,
        familyId: family.id,
        taskId,
        from: family.assistant_phone_e164,
        to: outcome.selectedContact.phoneE164,
        body: "Confirmed, thank you! You're booked.",
        occurredAt: args.occurredAt
      });
    }

    for (const c of outcome.rejectedContacts) {
      if (!c.phoneE164) continue;
      await sendAndLogSms({
        services,
        familyId: family.id,
        taskId,
        from: family.assistant_phone_e164,
        to: c.phoneE164,
        body: "Thanks! We’re covered this time.",
        occurredAt: args.occurredAt
      });
    }
    return;
  }
}
