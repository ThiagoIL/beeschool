// Sem "server-only": o middleware (runtime Node.js) também usa este arquivo. Nunca importe em componentes do navegador.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as core from "@/db/schema";
import * as erp from "@/db/erp";

const schema = { ...core, ...erp };
import { env } from "./env";

type DB = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __erpPool?: pg.Pool; __erpDb?: DB };

function newPool() {
  const p = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  // só um ouvinte por pool (o módulo é carregado de novo no middleware e no hot reload)
  p.on("error", (err) => console.error("[db] erro na conexão ociosa:", err.message));
  return p;
}
const pool = g.__erpPool ?? newPool();

/** Acesso ao banco. Use apenas no servidor. */
export const db: DB = g.__erpDb ?? drizzle(pool, { schema });
g.__erpPool = pool;
g.__erpDb = db;

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function pingDb(): Promise<boolean> {
  try { await pool.query("select 1"); return true; } catch { return false; }
}
