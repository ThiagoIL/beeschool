// Bootstrap idempotente (roda no início do container, depois das migrações). Pode rodar quantas vezes quiser.
//  1) conta master do console (INITIAL_ADMIN_NAME, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD), se ainda não existir;
//  2) instalação única: o cliente (INITIAL_TENANT_SLUG, INITIAL_TENANT_NAME), se ainda não existir nenhum;
//  3) primeiro administrador do cliente (INITIAL_TENANT_ADMIN_EMAIL + INITIAL_TENANT_ADMIN_PASSWORD), se o cliente não tiver nenhum.
// Sem as variáveis, a etapa correspondente não faz nada. Depois de criar, apague as senhas das variáveis de ambiente.
import bcrypt from "bcryptjs";
import { pool, newId, passwordProblem } from "./_common.mjs";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const db = pool();
try {
  // 1) conta master
  const email = env("INITIAL_ADMIN_EMAIL").toLowerCase(), pass = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  const { rows: master } = await db.query("select email from users where is_master limit 1");
  if (master.length) console.log(`[bootstrap] conta master já existe (${master[0].email}).`);
  else if (!email || !pass) console.log("[bootstrap] sem conta master: defina INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD para criá-la.");
  else {
    const prob = passwordProblem(pass, email);
    if (prob) { console.error(`[bootstrap] INITIAL_ADMIN_PASSWORD inválida: ${prob}.`); process.exitCode = 1; }
    else {
      await db.query(`insert into users (id, tenant_id, name, email, password_hash, role, status, is_master, must_change_password) values ($1, null, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE', true, false)`,
        [newId(), env("INITIAL_ADMIN_NAME", "Administrador") || "Administrador", email, await bcrypt.hash(pass, 12)]);
      await db.query(`insert into audit_logs (id, action, user_email, data) values ($1, 'master.criado', $2, '{"origem":"bootstrap"}')`, [newId(), email]);
      console.log(`[bootstrap] conta master criada: ${email}. No primeiro acesso ao console, configure o autenticador (2FA).`);
    }
  }

  // 2) cliente da instalação
  const slug = env("INITIAL_TENANT_SLUG").toLowerCase();
  let tenantId = null;
  const { rows: ts } = await db.query("select id, slug from tenants order by created_at limit 1");
  if (ts.length) { tenantId = ts[0].id; console.log(`[bootstrap] cliente já existe (${ts[0].slug}).`); }
  else if (!slug) console.log("[bootstrap] sem cliente: defina INITIAL_TENANT_SLUG e INITIAL_TENANT_NAME, ou crie pelo console.");
  else if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(slug)) { console.error("[bootstrap] INITIAL_TENANT_SLUG inválido (minúsculas, números e hífen)."); process.exitCode = 1; }
  else {
    tenantId = newId();
    await db.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [tenantId, slug, env("INITIAL_TENANT_NAME", slug) || slug]);
    await db.query(`insert into audit_logs (id, tenant_id, action, data) values ($1, $2, 'cliente.criado', '{"origem":"bootstrap"}')`, [newId(), tenantId]);
    console.log(`[bootstrap] cliente criado: ${slug}.${env("ROOT_DOMAIN")}`);
  }

  // 3) primeiro administrador do cliente
  const aEmail = env("INITIAL_TENANT_ADMIN_EMAIL").toLowerCase(), aPass = process.env.INITIAL_TENANT_ADMIN_PASSWORD ?? "";
  if (tenantId && aEmail && aPass) {
    const { rows: admins } = await db.query("select 1 from users where tenant_id = $1 and role = 'TENANT_ADMIN' limit 1", [tenantId]);
    if (admins.length) console.log("[bootstrap] o cliente já tem administrador.");
    else {
      const prob = passwordProblem(aPass, aEmail);
      if (prob) { console.error(`[bootstrap] INITIAL_TENANT_ADMIN_PASSWORD inválida: ${prob}.`); process.exitCode = 1; }
      else {
        await db.query(`insert into users (id, tenant_id, name, email, password_hash, role, must_change_password) values ($1, $2, $3, $4, $5, 'TENANT_ADMIN', true)`,
          [newId(), tenantId, env("INITIAL_TENANT_ADMIN_NAME", "Administrador") || "Administrador", aEmail, await bcrypt.hash(aPass, 12)]);
        console.log(`[bootstrap] administrador do cliente criado: ${aEmail} (troca de senha obrigatória no primeiro acesso).`);
      }
    }
  }
} catch (err) {
  console.error("[bootstrap] falhou:", err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
