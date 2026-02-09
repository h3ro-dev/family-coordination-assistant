import { Pool, PoolClient } from "pg";
import { env } from "../config";

let _pool: Pool | undefined;

export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: env.DATABASE_URL });
  return _pool;
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const res = await fn(client);
      await client.query("COMMIT");
      return res;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}

