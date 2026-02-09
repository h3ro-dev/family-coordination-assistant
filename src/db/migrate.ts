import { env } from "../config";
import { runMigrations } from "./runMigrations";

async function main() {
  try {
    await runMigrations(env.DATABASE_URL);
    console.log("[db:migrate] Done");
  } catch (err) {
    console.error("[db:migrate] Failed:", err);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[db:migrate] Failed:", err);
  process.exitCode = 1;
});
