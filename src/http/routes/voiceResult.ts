import { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { AppServices } from "../buildServer";
import { handleInboundVoiceResult } from "../../orchestrator/handleInboundVoiceResult";

const SlotSchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date()
  })
  .refine((s) => s.end.getTime() > s.start.getTime(), { message: "end must be after start" });

const PayloadSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["twilio", "grok", "proxy", "fake"]).default("proxy"),
  familyId: z.string().uuid(),
  taskId: z.string().uuid(),
  contactId: z.string().uuid(),
  transcript: z.string().optional(),
  note: z.string().optional(),
  offeredSlots: z.array(SlotSchema).default([])
});

export function registerVoiceResultRoutes(app: FastifyInstance, services: AppServices) {
  app.post("/webhooks/voice/result", async (req, reply) => {
    if (!env.INBOUND_VOICE_TOKEN) {
      reply.code(503);
      return { ok: false, error: "inbound_voice_not_configured" };
    }

    const token = String(req.headers["x-inbound-token"] ?? "");
    if (token !== env.INBOUND_VOICE_TOKEN) {
      reply.code(401);
      return { ok: false, error: "unauthorized" };
    }

    const input = PayloadSchema.safeParse(req.body ?? {});
    if (!input.success) {
      reply.code(400);
      return { ok: false, error: "invalid_payload" };
    }

    const res = await handleInboundVoiceResult({
      services,
      provider: input.data.provider,
      providerMessageId: input.data.id,
      familyId: input.data.familyId,
      taskId: input.data.taskId,
      contactId: input.data.contactId,
      transcript: input.data.transcript ?? null,
      note: input.data.note ?? null,
      offeredSlots: input.data.offeredSlots,
      occurredAt: new Date()
    });

    return res;
  });
}

