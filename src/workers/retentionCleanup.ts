import { withTransaction } from "../db/pool";

export async function runRetentionCleanup(): Promise<void> {
  // MVP default: keep SMS/email transcripts for 30 days.
  // (This is about reducing privacy risk, not because storage is expensive.)
  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM message_events WHERE occurred_at < (now() - interval '30 days')"
    );

    // Voice jobs can contain call transcripts in `last_transcript` / `result_json`.
    // Keep only 30 days for terminal jobs to reduce privacy risk.
    await client.query(
      `
        DELETE FROM voice_jobs
        WHERE updated_at < (now() - interval '30 days')
          AND status IN ('completed','failed','cancelled')
      `
    );
  });
}
