import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { AppServices } from "../buildServer";
import { handleInboundEmail } from "../../orchestrator/handleInboundEmail";

function extractEmailAddress(value: string): string {
  const v = value.trim();
  const m = /<([^>]+)>/.exec(v);
  return (m ? m[1] : v).trim().toLowerCase();
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNested(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    const rec: Record<string, unknown> = cur;
    cur = rec[key];
  }
  return cur;
}

function extractFamilyIdFromTo(toEmail: string): string | null {
  const addr = extractEmailAddress(toEmail);
  const m = /^([^@]+)@/.exec(addr);
  if (!m) return null;
  const local = m[1];
  const plusIdx = local.indexOf("+");
  if (plusIdx < 0) return null;
  const tag = local.slice(plusIdx + 1);
  // UUID v4-ish validation (good enough for routing).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tag)) return null;
  return tag;
}

export function registerResendInboundRoutes(app: FastifyInstance, services: AppServices) {
  const handler = async (
    req: FastifyRequest,
    reply: FastifyReply,
    provider: "resend" | "proxy"
  ) => {
    if (!env.INBOUND_EMAIL_TOKEN) {
      reply.code(503);
      return { ok: false, error: "inbound_email_not_configured" };
    }
    const token = String(req.headers["x-inbound-token"] ?? "");
    if (token !== env.INBOUND_EMAIL_TOKEN) {
      reply.code(401);
      return { ok: false, error: "unauthorized" };
    }

    // Accept a couple of common shapes:
    // 1) { id, from, to, text }
    // 2) { data: { id, from, to, text } }
    const body: unknown = req.body;
    const providerMessageId =
      firstString(getNested(body, ["id"])) ||
      firstString(getNested(body, ["message_id"])) ||
      firstString(getNested(body, ["data", "id"])) ||
      firstString(getNested(body, ["data", "message_id"])) ||
      "unknown";

    const fromRaw =
      firstString(getNested(body, ["from"])) ||
      firstString(getNested(body, ["data", "from"])) ||
      firstString(getNested(body, ["data", "sender"])) ||
      "";

    const toRaw =
      firstString(getNested(body, ["to"])) ||
      firstString(getNested(body, ["data", "to"])) ||
      firstString(getNested(body, ["data", "recipient"])) ||
      "";

    const textRaw =
      firstString(getNested(body, ["text"])) ||
      firstString(getNested(body, ["data", "text"])) ||
      firstString(getNested(body, ["data", "content", "text"])) ||
      firstString(getNested(body, ["data", "plain_text"])) ||
      "";

    const schema = z.object({
      from: z.string().min(3),
      to: z.string().min(3),
      text: z.string().min(1)
    });

    const parsed = schema.safeParse({
      from: fromRaw,
      to: toRaw,
      text: textRaw
    });
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: "invalid_payload" };
    }

    const fromEmail = extractEmailAddress(parsed.data.from);
    const toEmail = extractEmailAddress(parsed.data.to);
    const familyId = extractFamilyIdFromTo(toEmail);
    if (!familyId) {
      reply.code(400);
      return { ok: false, error: "missing_family_routing" };
    }

    await handleInboundEmail({
      services,
      provider,
      providerMessageId,
      familyId,
      fromEmail,
      toEmail,
      text: parsed.data.text,
      occurredAt: new Date()
    });

    return { ok: true };
  };

  app.post("/webhooks/resend/inbound", async (req, reply) => handler(req, reply, "resend"));
  app.post("/webhooks/email/inbound", async (req, reply) => handler(req, reply, "proxy"));
}
