import { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import { env } from "../../config";
import { withTransaction } from "../../db/pool";
import { parseOfferedSlotsFromTranscript } from "../../domain/parsing/parseOfferedSlotsFromTranscript";
import { parseYesNo } from "../../domain/parsing/parseYesNo";
import { handleInboundVoiceResult } from "../../orchestrator/handleInboundVoiceResult";
import { sendAndLogSms } from "../../orchestrator/messaging";
import { AppServices } from "../buildServer";
import { JOB_DIAL_VOICE_JOB } from "../../jobs/boss";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function hangupWith(message: string): string {
  return twiml(`<Say>${escXml(message)}</Say><Hangup/>`);
}

function ensureWebhookToken(query: Record<string, unknown>): boolean {
  const expected = env.TWILIO_VOICE_WEBHOOK_TOKEN;
  if (!expected) return true; // allow in dev/test
  const got = String(query.token ?? "");
  return got === expected;
}

type VoiceJobContext = {
  jobId: string;
  familyId: string;
  taskId: string;
  contactId: string;
  kind: "availability" | "booking";
  status: string;
  attempt: number;
  providerCallSid: string | null;
  optionId: string | null;
  assistantPhoneE164: string;
  timezone: string;
  contactName: string;
  intentType: string;
  taskMetadata: unknown;
  optionSlotStart: Date | null;
  optionSlotEnd: Date | null;
};

function safeJson(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj === "object") return obj as Record<string, unknown>;
  return {};
}

async function loadVoiceJobContext(jobId: string): Promise<VoiceJobContext | null> {
  return await withTransaction(async (client) => {
    const res = await client.query<{
      job_id: string;
      family_id: string;
      task_id: string;
      contact_id: string;
      kind: string;
      status: string;
      attempt: number;
      provider_call_sid: string | null;
      option_id: string | null;
      assistant_phone_e164: string;
      timezone: string;
      contact_name: string;
      intent_type: string;
      task_metadata: unknown;
      option_slot_start: Date | null;
      option_slot_end: Date | null;
    }>(
      `
        SELECT
          j.id as job_id,
          j.family_id,
          j.task_id,
          j.contact_id,
          j.kind,
          j.status,
          j.attempt,
          j.provider_call_sid,
          j.option_id,
          f.assistant_phone_e164,
          f.timezone,
          c.name as contact_name,
          t.intent_type,
          t.metadata as task_metadata,
          o.slot_start as option_slot_start,
          o.slot_end as option_slot_end
        FROM voice_jobs j
        JOIN families f ON f.id = j.family_id
        JOIN contacts c ON c.id = j.contact_id
        JOIN tasks t ON t.id = j.task_id
        LEFT JOIN task_options o ON o.id = j.option_id
        WHERE j.id = $1
        LIMIT 1
      `,
      [jobId]
    );
    const row = res.rows[0];
    if (!row) return null;

    const kind = row.kind === "booking" ? "booking" : "availability";
    return {
      jobId: row.job_id,
      familyId: row.family_id,
      taskId: row.task_id,
      contactId: row.contact_id,
      kind,
      status: row.status,
      attempt: row.attempt,
      providerCallSid: row.provider_call_sid,
      optionId: row.option_id,
      assistantPhoneE164: row.assistant_phone_e164,
      timezone: row.timezone,
      contactName: row.contact_name,
      intentType: row.intent_type,
      taskMetadata: row.task_metadata,
      optionSlotStart: row.option_slot_start,
      optionSlotEnd: row.option_slot_end
    };
  });
}

export function registerTwilioVoiceRoutes(app: FastifyInstance, services: AppServices) {
  app.register(async (voice) => {
    voice.post("/webhooks/twilio/voice/answer", async (req, reply) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      if (!ensureWebhookToken(query)) {
        reply.code(403).type("text/plain").send("forbidden");
        return;
      }

      const jobId = String(query.jobId ?? "").trim();
      if (!jobId) {
        reply.type("text/xml").send(hangupWith("Sorry, something went wrong. Goodbye."));
        return;
      }

      const ctx = await loadVoiceJobContext(jobId);
      if (!ctx) {
        reply.type("text/xml").send(hangupWith("Sorry, something went wrong. Goodbye."));
        return;
      }

      // If the job is already done, end quickly.
      if (ctx.status === "completed" || ctx.status === "failed" || ctx.status === "cancelled") {
        reply.type("text/xml").send(hangupWith("This call is no longer needed. Goodbye."));
        return;
      }

      // Update status to in_progress when Twilio hits the answer webhook.
      const callSid = String(((req.body ?? {}) as Record<string, unknown>).CallSid ?? "").trim() || null;
      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE voice_jobs
            SET status = 'in_progress',
                provider_call_sid = COALESCE(provider_call_sid, $2),
                updated_at = now()
            WHERE id = $1
          `,
          [ctx.jobId, callSid]
        );
      });

      const token = env.TWILIO_VOICE_WEBHOOK_TOKEN;
      const gatherUrl = new URLSearchParams();
      gatherUrl.set("jobId", ctx.jobId);
      gatherUrl.set("turn", "1");
      if (token) gatherUrl.set("token", token);

      const action = `/webhooks/twilio/voice/gather?${gatherUrl.toString()}`;

      if (ctx.kind === "booking") {
        if (!ctx.optionSlotStart) {
          reply.type("text/xml").send(hangupWith("Sorry, we do not have the appointment time. Goodbye."));
          return;
        }

        const start = DateTime.fromJSDate(ctx.optionSlotStart, { zone: ctx.timezone }).toFormat(
          "cccc LLLL d 'at' h:mm a"
        );

        const say = `Hello. This is an automated assistant calling to confirm an appointment time. Can you confirm ${start}? Please say yes or no.`;
        const xml = twiml(
          `<Gather input="speech" action="${escXml(action)}" method="POST" timeout="4" speechTimeout="auto">
            <Say>${escXml(say)}</Say>
          </Gather>
          <Say>${escXml("Sorry, I did not hear a response. Goodbye.")}</Say>
          <Hangup/>`
        );
        reply.type("text/xml").send(xml);
        return;
      }

      // Availability call
      const xml = twiml(
        `<Gather input="speech" action="${escXml(action)}" method="POST" timeout="5" speechTimeout="auto">
          <Say>${escXml(
            "Hello. I'm calling to check appointment availability. Please say the next two or three available appointment times. For example: Tuesday February 12 at 3 30 P M."
          )}</Say>
        </Gather>
        <Say>${escXml("Sorry, I did not hear anything. Goodbye.")}</Say>
        <Hangup/>`
      );
      reply.type("text/xml").send(xml);
    });

    voice.post("/webhooks/twilio/voice/gather", async (req, reply) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      if (!ensureWebhookToken(query)) {
        reply.code(403).type("text/plain").send("forbidden");
        return;
      }

      const schema = z.object({
        jobId: z.string().min(1),
        turn: z.string().optional()
      });
      const parsedQuery = schema.parse(query);

      const turn = Number(parsedQuery.turn ?? "1") || 1;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const speech = String(body.SpeechResult ?? "").trim();
      const callSid = String(body.CallSid ?? "").trim();

      const ctx = await loadVoiceJobContext(parsedQuery.jobId);
      if (!ctx) {
        reply.type("text/xml").send(hangupWith("Sorry, something went wrong. Goodbye."));
        return;
      }

      if (ctx.status === "completed" || ctx.status === "failed" || ctx.status === "cancelled") {
        reply.type("text/xml").send(hangupWith("Thank you. Goodbye."));
        return;
      }

      // Persist transcript for debugging (even if we fail to parse it).
      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE voice_jobs
            SET last_transcript = $2,
                provider_call_sid = COALESCE(provider_call_sid, $3),
                updated_at = now()
            WHERE id = $1
          `,
          [ctx.jobId, speech || null, callSid || null]
        );

        if (speech) {
          await client.query(
            `
              INSERT INTO message_events (
                family_id, task_id, direction, channel, from_addr, to_addr, body,
                provider, provider_message_id, occurred_at
              ) VALUES ($1,$2,'inbound','voice',$3,$4,$5,'twilio',$6,now())
              ON CONFLICT (provider, provider_message_id) DO NOTHING
            `,
            [
              ctx.familyId,
              ctx.taskId,
              `contact:${ctx.contactId}`,
              `family:${ctx.familyId}`,
              `Transcript: ${speech}`,
              `voice-transcript:${callSid}:${turn}`
            ]
          );
        }
      });

      if (ctx.kind === "booking") {
        const yn = parseYesNo(speech);
        if (yn === "unknown" && turn < 2) {
          const token = env.TWILIO_VOICE_WEBHOOK_TOKEN;
          const qs = new URLSearchParams();
          qs.set("jobId", ctx.jobId);
          qs.set("turn", String(turn + 1));
          if (token) qs.set("token", token);
          const action = `/webhooks/twilio/voice/gather?${qs.toString()}`;

          const xml = twiml(
            `<Gather input="speech" action="${escXml(action)}" method="POST" timeout="4" speechTimeout="auto">
              <Say>${escXml("Sorry, I did not catch that. Please say yes or no.")}</Say>
            </Gather>
            <Say>${escXml("Sorry, I did not hear a response. Goodbye.")}</Say>
            <Hangup/>`
          );
          reply.type("text/xml").send(xml);
          return;
        }

        const outcome = await withTransaction(async (client) => {
          const meta = safeJson(ctx.taskMetadata);
          const initiatorPhone = meta.initiatorPhoneE164 as string | undefined;

          if (yn === "yes") {
            await client.query(
              `
                UPDATE tasks
                SET status = 'confirmed',
                    awaiting_parent = false,
                    awaiting_parent_reason = NULL,
                    updated_at = now()
                WHERE id = $1
              `,
              [ctx.taskId]
            );

            await client.query(
              `
                UPDATE voice_jobs
                SET status = 'completed',
                    result_json = $2::jsonb,
                    updated_at = now()
                WHERE id = $1
              `,
              [
                ctx.jobId,
                JSON.stringify({
                  kind: "booking",
                  result: "yes",
                  transcript: speech || null,
                  callSid: callSid || null
                })
              ]
            );

            return { type: "confirmed" as const, initiatorPhone };
          }

          // No or unknown after retry: release the option back to the parent flow.
          if (ctx.optionId) {
            await client.query("UPDATE task_options SET status = 'rejected' WHERE id = $1", [ctx.optionId]);
            await client.query(
              "UPDATE task_options SET status = 'pending' WHERE task_id = $1 AND status = 'rejected' AND id <> $2",
              [ctx.taskId, ctx.optionId]
            );
          }

          // Only re-prompt if safe (no other awaiting-parent task).
          const otherAwaiting = await client.query<{ id: string }>(
            `
              SELECT id
              FROM tasks
              WHERE family_id = $1 AND awaiting_parent = true AND id <> $2
              LIMIT 1
            `,
            [ctx.familyId, ctx.taskId]
          );

          const canPrompt = otherAwaiting.rowCount === 0 && !!initiatorPhone;
          if (canPrompt) {
            await client.query(
              `
                UPDATE tasks
                SET status = 'options_ready',
                    awaiting_parent = true,
                    awaiting_parent_reason = 'choose_option',
                    updated_at = now()
                WHERE id = $1
              `,
              [ctx.taskId]
            );
          } else {
            await client.query(
              `
                UPDATE tasks
                SET status = 'collecting',
                    updated_at = now()
                WHERE id = $1
              `,
              [ctx.taskId]
            );
          }

          await client.query(
            `
              UPDATE voice_jobs
              SET status = 'failed',
                  last_error = $2,
                  result_json = $3::jsonb,
                  updated_at = now()
              WHERE id = $1
            `,
            [
              ctx.jobId,
              yn === "no" ? "clinic_rejected_slot" : "unable_to_confirm_slot",
              JSON.stringify({
                kind: "booking",
                result: yn,
                transcript: speech || null,
                callSid: callSid || null
              })
            ]
          );

          return { type: "rejected" as const, canPrompt, initiatorPhone };
        });

        if (outcome.type === "confirmed" && outcome.initiatorPhone) {
          const start = ctx.optionSlotStart
            ? DateTime.fromJSDate(ctx.optionSlotStart, { zone: ctx.timezone }).toFormat("ccc L/d h:mma")
            : "the selected time";

          await sendAndLogSms({
            services,
            familyId: ctx.familyId,
            taskId: ctx.taskId,
            from: ctx.assistantPhoneE164,
            to: outcome.initiatorPhone,
            body: `Confirmed with ${ctx.contactName}: ${start}.`,
            occurredAt: new Date()
          });
        }

        if (outcome.type === "rejected" && outcome.initiatorPhone) {
          if (outcome.canPrompt) {
            await sendAndLogSms({
              services,
              familyId: ctx.familyId,
              taskId: ctx.taskId,
              from: ctx.assistantPhoneE164,
              to: outcome.initiatorPhone,
              body: `They couldn’t confirm that slot. Reply with a new option number.`,
              occurredAt: new Date()
            });
          } else {
            await sendAndLogSms({
              services,
              familyId: ctx.familyId,
              taskId: ctx.taskId,
              from: ctx.assistantPhoneE164,
              to: outcome.initiatorPhone,
              body: `They couldn’t confirm that slot. Text STATUS and I’ll follow up when I can safely prompt you again.`,
              occurredAt: new Date()
            });
          }
        }

        reply.type("text/xml").send(hangupWith("Thank you. Goodbye."));
        return;
      }

      // Availability flow
      const defaultMinutes = ctx.intentType === "therapy" ? 45 : 30;
      const now = DateTime.now().setZone(ctx.timezone);
      const extracted = speech
        ? parseOfferedSlotsFromTranscript(speech, { now, defaultDurationMinutes: defaultMinutes })
        : [];

      if (extracted.length === 0 && turn < 2) {
        const token = env.TWILIO_VOICE_WEBHOOK_TOKEN;
        const qs = new URLSearchParams();
        qs.set("jobId", ctx.jobId);
        qs.set("turn", String(turn + 1));
        if (token) qs.set("token", token);
        const action = `/webhooks/twilio/voice/gather?${qs.toString()}`;
        const xml = twiml(
          `<Gather input="speech" action="${escXml(action)}" method="POST" timeout="6" speechTimeout="auto">
            <Say>${escXml(
              "Sorry, I did not catch the appointment times. Please repeat the next available times with a date, for example: February 12 at 3 30 P M."
            )}</Say>
          </Gather>
          <Say>${escXml("Sorry, I did not hear anything. Goodbye.")}</Say>
          <Hangup/>`
        );
        reply.type("text/xml").send(xml);
        return;
      }

      if (extracted.length === 0) {
        await withTransaction(async (client) => {
          await client.query(
            `
              UPDATE voice_jobs
              SET status = 'failed',
                  last_error = 'unable_to_extract_slots',
                  updated_at = now()
              WHERE id = $1
            `,
            [ctx.jobId]
          );
        });
        reply.type("text/xml").send(hangupWith("Sorry. I was not able to capture times. Goodbye."));
        return;
      }

      // Mark job complete and ingest as a structured result.
      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE voice_jobs
            SET status = 'completed',
                result_json = $2::jsonb,
                updated_at = now()
            WHERE id = $1
          `,
          [
            ctx.jobId,
            JSON.stringify({
              kind: "availability",
              offeredSlots: extracted.slice(0, 3).map((s) => ({
                start: s.start.toISO(),
                end: s.end.toISO()
              })),
              transcript: speech || null,
              callSid: callSid || null
            })
          ]
        );
      });

      await handleInboundVoiceResult({
        services,
        provider: "twilio",
        providerMessageId: `twilio-call:${callSid || ctx.jobId}:availability`,
        familyId: ctx.familyId,
        taskId: ctx.taskId,
        contactId: ctx.contactId,
        transcript: speech || null,
        note: null,
        offeredSlots: extracted.map((s) => ({ start: s.start.toJSDate(), end: s.end.toJSDate() })),
        occurredAt: new Date()
      });

      reply.type("text/xml").send(hangupWith("Thank you. Goodbye."));
    });

    // Twilio call status callbacks (best-effort reliability).
    voice.post("/webhooks/twilio/voice/status", async (req, reply) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      if (!ensureWebhookToken(query)) {
        reply.code(403).type("text/plain").send("forbidden");
        return;
      }

      const jobId = String(query.jobId ?? "").trim();
      if (!jobId) {
        reply.code(400).type("text/plain").send("missing jobId");
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const callSid = String(body.CallSid ?? "").trim() || null;
      const callStatus = String(body.CallStatus ?? "").trim().toLowerCase();

      const terminalFailure = ["busy", "failed", "no-answer", "canceled"];
      const isTerminalFailure = terminalFailure.includes(callStatus);

      const shouldRetry = await withTransaction(async (client) => {
        // Lock the row to avoid racing with gather completion.
        const res = await client.query<{ status: string; attempt: number; kind: string }>(
          `SELECT status, attempt, kind FROM voice_jobs WHERE id = $1 FOR UPDATE`,
          [jobId]
        );
        const row = res.rows[0];
        if (!row) return false;

        // If already completed, ignore callbacks.
        if (row.status === "completed" || row.status === "cancelled") return false;

        if (callStatus === "answered" || callStatus === "in-progress") {
          await client.query(
            `
              UPDATE voice_jobs
              SET status = 'in_progress',
                  provider_call_sid = COALESCE(provider_call_sid, $2),
                  updated_at = now()
              WHERE id = $1
            `,
            [jobId, callSid]
          );
          return false;
        }

        if (callStatus === "completed") {
          // If the call completed but we never produced a structured result, mark failed.
          if (row.status !== "completed") {
            await client.query(
              `
                UPDATE voice_jobs
                SET status = 'failed',
                    last_error = 'call_completed_without_result',
                    provider_call_sid = COALESCE(provider_call_sid, $2),
                    updated_at = now()
                WHERE id = $1
              `,
              [jobId, callSid]
            );
          }
          return false;
        }

        if (isTerminalFailure) {
          await client.query(
            `
              UPDATE voice_jobs
              SET status = 'failed',
                  last_error = $2,
                  provider_call_sid = COALESCE(provider_call_sid, $3),
                  updated_at = now()
              WHERE id = $1
            `,
            [jobId, `call_status:${callStatus}`, callSid]
          );

          // Retry max 3 attempts.
          return row.attempt < 3;
        }

        return false;
      });

      if (shouldRetry && services.boss) {
        // Match dialVoiceJob retry policy by kind using the stored row.
        const ctx = await loadVoiceJobContext(jobId);
        const startAfter =
          ctx?.kind === "availability"
            ? DateTime.utc().plus({ hours: 24 }).toJSDate()
            : DateTime.utc().plus({ minutes: 10 }).toJSDate();
        await services.boss.send(JOB_DIAL_VOICE_JOB, { voiceJobId: jobId }, { startAfter });
      }

      reply.type("text/plain").send("ok");
    });
  });
}

