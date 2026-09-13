import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
let instance: Database | undefined;
export function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_PRIVATE_URL) return process.env.DATABASE_PRIVATE_URL;
  if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;
  if (process.env.PG_CONNECTION_STRING) return process.env.PG_CONNECTION_STRING;
  if (process.env.PGHOST) {
    const user = encodeURIComponent(process.env.PGUSER || "postgres");
    const pass = encodeURIComponent(process.env.PGPASSWORD || "");
    const host = process.env.PGHOST;
    const port = process.env.PGPORT || 5432;
    const db = process.env.PGDATABASE || "railway";
    return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
  }
  return undefined;
}

export function getDb() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    const availableEnv = Object.keys(process.env).filter(
      (k) =>
        k.includes("DATA") ||
        k.includes("POSTGRES") ||
        k.includes("PG") ||
        k.includes("DB"),
    );
    throw new Error(
      `DATABASE_URL is missing in Railway environment variables. Available matching env vars: [${availableEnv.join(", ")}]. Please add DATABASE_URL in Railway Dashboard -> Variables.`,
    );
  }
  return (instance ??= drizzle(
    new Pool({ connectionString, max: 10 }),
    { schema },
  ));
}
