process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "test-admin-token";
process.env.DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "America/Denver";

// Tests expect a local docker-compose Postgres running.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55433/fca_test";

