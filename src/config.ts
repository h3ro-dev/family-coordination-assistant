import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3007),

  DATABASE_URL: z.string().min(1),

  // Pilot: single shared admin token for a tiny admin API surface.
  ADMIN_TOKEN: z.string().min(1).optional(),

  // Optional because tests/local dev can run with fake adapters.
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_REPLY_TO: z.string().min(1).optional(),
  INBOUND_EMAIL_TOKEN: z.string().min(1).optional(),

  DEFAULT_TIMEZONE: z.string().min(1).default("UTC")
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
