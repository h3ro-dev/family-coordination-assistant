import { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance) {
  app.get("/healthz", async () => ({ ok: true }));
}

