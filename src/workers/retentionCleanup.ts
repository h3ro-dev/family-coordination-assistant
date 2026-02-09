import { withTransaction } from "../db/pool";

export async function runRetentionCleanup(): Promise<void> {
  // MVP default: keep SMS/email transcripts for 30 days.
  // (This is about reducing privacy risk, not because storage is expensive.)
  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM message_events WHERE occurred_at < (now() - interval '30 days')"
    );
  });
}

