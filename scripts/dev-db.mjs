// Banco PostgreSQL de DESENVOLVIMENTO sem Docker (PGlite). Uso: node scripts/dev-db.mjs <pasta-dos-dados>
// Aceita uma conexão por vez: use DATABASE_POOL_MAX=1 no .env. Nunca use em produção.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dir = process.argv[2];
if (!dir) { console.error("Informe a pasta dos dados: node scripts/dev-db.mjs ./.pgdata"); process.exit(1); }
// conexão derrubada pelo cliente (ECONNRESET) não pode derrubar o banco de desenvolvimento
process.on("uncaughtException", (e) => console.error("[dev-db] conexão encerrada:", e.code ?? e.message));
const db = await PGlite.create(dir);
const server = new PGLiteSocketServer({ db, port: Number(process.env.DEV_DB_PORT ?? 5433), host: "127.0.0.1" });
await server.start();
console.log(`PGLITE READY ${process.env.DEV_DB_PORT ?? 5433}`);
