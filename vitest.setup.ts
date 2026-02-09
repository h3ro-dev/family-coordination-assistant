process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "test-admin-token";
process.env.DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "America/Denver";
process.env.EMAIL_FROM = process.env.EMAIL_FROM ?? "assistant@example.com";
process.env.EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "assistant@example.com";
process.env.INBOUND_EMAIL_TOKEN = process.env.INBOUND_EMAIL_TOKEN ?? "test-inbound-token";
process.env.INBOUND_VOICE_TOKEN = process.env.INBOUND_VOICE_TOKEN ?? "test-voice-token";
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3007";
process.env.TWILIO_VOICE_WEBHOOK_TOKEN = process.env.TWILIO_VOICE_WEBHOOK_TOKEN ?? "test-twilio-voice-token";

// Tests expect a local docker-compose Postgres running.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55433/fca_test";
