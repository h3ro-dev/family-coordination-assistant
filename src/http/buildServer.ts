import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import PgBoss from "pg-boss";
import { SmsAdapter } from "../adapters/sms/SmsAdapter";
import { EmailAdapter } from "../adapters/email/EmailAdapter";
import { registerHealthRoutes } from "./routes/health";
import { registerTwilioRoutes } from "./routes/twilioSms";
import { registerAdminRoutes } from "./routes/admin";
import { registerAdminUiRoutes } from "./routes/adminUi";

export type AppServices = {
  sms: SmsAdapter;
  email: EmailAdapter;
  boss?: PgBoss;
};

export function buildServer(services: AppServices): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(formbody);

  registerHealthRoutes(app);
  registerTwilioRoutes(app, services);
  registerAdminRoutes(app, services);
  registerAdminUiRoutes(app, services);

  return app;
}
