// Bootstrap idempotente (roda no início do container, depois das migrações). Pode rodar quantas vezes quiser.
//  1) conta master do console (PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD), se ainda não existir;
//  2) configuração do sistema (linha única) e primeiro administrador da escola (ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD),
//     se a escola ainda não tiver nenhum administrador.
// Sem as variáveis, a etapa correspondente não faz nada. Depois de criar, apague as senhas das variáveis de ambiente.
import bcrypt from "bcryptjs";
import { pool, newId, passwordProblem } from "./_common.mjs";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const db = pool();
try {
  // 1) conta master do console
  const email = env("PLATFORM_ADMIN_EMAIL").toLowerCase(), pass = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
  const { rows: master } = await db.query("select email from users where is_master limit 1");
  if (master.length) console.log(`[bootstrap] conta master do console já existe (${master[0].email}).`);
  else if (!email || !pass) console.log("[bootstrap] sem conta do console: defina PLATFORM_ADMIN_EMAIL e PLATFORM_ADMIN_PASSWORD para criá-la.");
  else {
    const prob = passwordProblem(pass, email);
    if (prob) { console.error(`[bootstrap] PLATFORM_ADMIN_PASSWORD inválida: ${prob}.`); process.exitCode = 1; }
    else {
      await db.query(`insert into users (id, name, email, password_hash, role, status, is_master, must_change_password) values ($1, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE', true, false)`,
        [newId(), env("PLATFORM_ADMIN_NAME", "Administrador") || "Administrador", email, await bcrypt.hash(pass, 12)]);
      await db.query(`insert into audit_logs (id, area, action, user_email, data) values ($1, 'CONSOLE', 'master.criado', $2, '{"origem":"bootstrap"}')`, [newId(), email]);
      console.log(`[bootstrap] conta master do console criada: ${email} (acesso em ${env("PLATFORM_ADMIN_PATH", "/sistema-admin") || "/sistema-admin"}).`);
    }
  }

  // 2) configuração do sistema e primeiro administrador da escola
  await db.query(`insert into system_settings (id, name) values ('main', 'Bee School & Bee Light') on conflict (id) do nothing`);
  const aEmail = env("ADMIN_EMAIL").toLowerCase(), aPass = process.env.ADMIN_PASSWORD ?? "";
  const { rows: admins } = await db.query("select 1 from users where role = 'ADMIN' limit 1");
  if (admins.length) console.log("[bootstrap] a escola já tem administrador.");
  else if (!aEmail || !aPass) console.log("[bootstrap] sem administrador da escola: defina ADMIN_EMAIL e ADMIN_PASSWORD, ou crie pelo console.");
  else {
    const prob = passwordProblem(aPass, aEmail);
    if (prob) { console.error(`[bootstrap] ADMIN_PASSWORD inválida: ${prob}.`); process.exitCode = 1; }
    else {
      await db.query(`insert into users (id, name, email, password_hash, role, must_change_password) values ($1, $2, $3, $4, 'ADMIN', true)`,
        [newId(), env("ADMIN_NAME", "Administrador") || "Administrador", aEmail, await bcrypt.hash(aPass, 12)]);
      console.log(`[bootstrap] administrador da escola criado: ${aEmail} (troca de senha obrigatória no primeiro acesso).`);
    }
  }
} catch (err) {
  console.error("[bootstrap] falhou:", err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
