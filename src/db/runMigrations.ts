import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const res = await client.query<{ name: string }>(
    "SELECT name FROM schema_migrations"
  );
  return new Set(res.rows.map((r) => r.name));
}

async function readMigrationFiles(migrationsDir: string): Promise<{ name: string; sql: string }[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  const migrations: { name: string; sql: string }[] = [];
  for (const name of files) {
    const fullPath = path.join(migrationsDir, name);
    const sql = await fs.readFile(fullPath, "utf8");
    migrations.push({ name, sql });
  }
  return migrations;
}

async function applyMigration(client: Client, name: string, sql: string) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
      name
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const migrationsDir = path.join(__dirname, "migrations");
    const migrations = await readMigrationFiles(migrationsDir);

    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      console.log(`[db:migrate] Applying ${m.name}`);
      await applyMigration(client, m.name, m.sql);
    }
  } finally {
    await client.end();
  }
}
