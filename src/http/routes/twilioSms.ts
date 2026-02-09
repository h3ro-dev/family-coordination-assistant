import { FastifyInstance } from "fastify";
import { AppServices } from "../buildServer";
import { handleInboundSms } from "../../orchestrator/handleInboundSms";

type TwilioInboundSmsBody = {
  MessageSid?: string;
  SmsSid?: string;
  AccountSid?: string;
  From?: string;
  To?: string;
  Body?: string;
};

export function registerTwilioRoutes(app: FastifyInstance, services: AppServices) {
  app.post("/webhooks/twilio/sms", async (req, reply) => {
    const body = (req.body ?? {}) as TwilioInboundSmsBody;
    const providerMessageId = body.MessageSid ?? body.SmsSid ?? "unknown";
    const from = (body.From ?? "").trim();
    const to = (body.To ?? "").trim();
    const text = (body.Body ?? "").trim();

    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: "missing From/To" };
    }

    await handleInboundSms({
      services,
      provider: "twilio",
      providerMessageId,
      from,
      to,
      text,
      occurredAt: new Date()
    });

    // Twilio doesn't require a response body if we're sending replies separately.
    reply.code(200);
    return { ok: true };
  });
}

