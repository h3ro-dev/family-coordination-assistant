import PgBoss from "pg-boss";
import { env } from "../config";

export const JOB_COMPILE_SITTER_OPTIONS = "compile-sitter-options";
export const JOB_RETRY_SITTER_OUTREACH = "retry-sitter-outreach";
export const JOB_RETENTION_CLEANUP = "retention-cleanup";

export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: env.DATABASE_URL });
}

