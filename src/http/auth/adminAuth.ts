import { FastifyInstance } from "fastify";
import { env } from "../../config";

function parseBasicAuth(header: string): { username: string; password: string } | null {
  if (!header.toLowerCase().startsWith("basic ")) return null;
  const b64 = header.slice("basic ".length).trim();
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function extractToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;

  if (headerValue.startsWith("Bearer ")) {
    return headerValue.slice("Bearer ".length).trim() || null;
  }

  const basic = parseBasicAuth(headerValue);
  if (basic) return basic.password || null;

  return null;
}

export function requireAdmin(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const expected = env.ADMIN_TOKEN;
    if (!expected) {
      // Misconfigured environment.
      reply.code(503);
      return reply.send({ ok: false, error: "admin_not_configured" });
    }

    const token = extractToken(req.headers["authorization"]);
    if (!token || token !== expected) {
      // For browsers, a 401 triggers the Basic Auth prompt.
      reply.header("WWW-Authenticate", "Basic realm=\"FCA Admin\"");
      reply.code(401);
      return reply.send({ ok: false, error: "unauthorized" });
    }
  });
}

