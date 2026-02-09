import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import PgBoss from "pg-boss";
import { SmsAdapter } from "../adapters/sms/SmsAdapter";
import { EmailAdapter } from "../adapters/email/EmailAdapter";
import { VoiceDialerAdapter } from "../adapters/voice/VoiceDialerAdapter";
import { registerHealthRoutes } from "./routes/health";
import { registerTwilioRoutes } from "./routes/twilioSms";
import { registerTwilioVoiceRoutes } from "./routes/twilioVoice";
import { registerAdminRoutes } from "./routes/admin";
import { registerAdminUiRoutes } from "./routes/adminUi";
import { registerResendInboundRoutes } from "./routes/resendInbound";
import { registerVoiceResultRoutes } from "./routes/voiceResult";

export type AppServices = {
  sms: SmsAdapter;
  email: EmailAdapter;
  boss?: PgBoss;
  // Used by the worker only (the API schedules jobs; it does not dial calls directly).
  voiceDialer?: VoiceDialerAdapter;
};

export function buildServer(services: AppServices): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(formbody);

  registerHealthRoutes(app);
  registerTwilioRoutes(app, services);
  registerResendInboundRoutes(app, services);
  registerVoiceResultRoutes(app, services);
  registerTwilioVoiceRoutes(app, services);
  registerAdminRoutes(app, services);
  registerAdminUiRoutes(app, services);

  return app;
}
