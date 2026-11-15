/**
 * Testes de banco: aplica as migrações num PostgreSQL em memória (PGlite) e confere que as regras
 * críticas valem no próprio banco (RLS com FORCE, gatilhos e CHECKs), mesmo sem passar pelo código.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const HASH = "$2b$12$opd9debQNUhrElkU44mKh.Ohe6/IWyv0jNqxU8ObcXDiY3Ib3REeq";

/** Executa como a aplicação dentro de withTenant(): papel erp_app + app.tenant_id. */
async function asTenant<T>(tenantId: string, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: T[] }>) => Promise<unknown>) {
  await db.exec("begin");
  try {
    await db.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await db.exec("set local role erp_app");
    const r = await fn((sql, p) => db.query<T>(sql, p));
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const rejects = async (p: Promise<unknown>, msg: RegExp) => { await expect(p).rejects.toThrow(msg); };

beforeAll(async () => {
  db = await PGlite.create();
  const dir = path.join(__dirname, "..", "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.exec(stmt);
  }
  await db.exec(`
    insert into tenants (id, slug, name) values ('tA', 'escola-a', 'Escola A'), ('tB', 'escola-b', 'Escola B');
    insert into users (id, tenant_id, name, email, password_hash, role) values
      ('m', null, 'Master', 'm@x.com', '${HASH}', 'SUPER_ADMIN'), ('a1', 'tA', 'Admin A', 'a@x.com', '${HASH}', 'TENANT_ADMIN');
    update users set is_master = true where id = 'm';
  `);
  for (const t of ["tA", "tB"]) {
    await asTenant(t, async (q) => {
      await q(`insert into companies (id, tenant_id, name) values ($1, $2, 'Bee School')`, [`co_${t}`, t]);
      await q(`insert into bank_accounts (id, tenant_id, company_id, name) values ($1, $2, $3, 'Sicredi 1')`, [`acc_${t}`, t, `co_${t}`]);
      await q(`insert into dre_groups (id, tenant_id, name, section) values ($1, $2, 'Despesas com Pessoal', 'OPERACIONAL')`, [`g_${t}`, t]);
      await q(`insert into fin_categories (id, tenant_id, name, group_id) values ($1, $2, 'Salários', $3)`, [`cat_${t}`, t, `g_${t}`]);
    });
  }
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("isolamento por cliente (RLS com FORCE)", () => {
  it("cada cliente só enxerga as próprias linhas", async () => {
    const rows = (await asTenant<{ id: string }>("tA", (q) => q("select id from companies"))) as { rows: { id: string }[] };
    expect(rows.rows.map((r) => r.id)).toEqual(["co_tA"]);
  });
  it("não grava linha de outro cliente", async () => {
    await rejects(asTenant("tA", (q) => q(`insert into companies (id, tenant_id, name) values ('x', 'tB', 'Invasora')`)), /row-level security/);
  });
  it("sem cliente informado, não enxerga nada", async () => {
    await db.exec("begin; set local role erp_app;");
    const r = await db.query("select * from fin_categories");
    await db.exec("rollback");
    expect(r.rows).toHaveLength(0);
  });
  it("FK composta impede apontar para cadastro de outro cliente", async () => {
    await rejects(asTenant("tA", (q) => q(`insert into bank_accounts (id, tenant_id, company_id, name) values ('acc_x', 'tA', 'co_tB', 'Conta X')`)), /foreign key/);
  });
});

describe("regras do financeiro no banco", () => {
  it("baixa exige data, valor e conta", async () => {
    await rejects(asTenant("tA", (q) => q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount, status) values ('t1', 'tA', 'PAGAR', 'co_tA', 'x', '2026-11-01', 10, 'PAGO')`)), /fin_titles_paid_ck/);
  });
  it("valor precisa ser positivo", async () => {
    await rejects(asTenant("tA", (q) => q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount) values ('t2', 'tA', 'PAGAR', 'co_tA', 'x', '2026-11-01', 0)`)), /fin_titles_amount_ck/);
  });
  it("conta de outra empresa do grupo é recusada", async () => {
    await asTenant("tA", (q) => q(`insert into companies (id, tenant_id, name) values ('co_light', 'tA', 'Bee Light')`));
    await rejects(asTenant("tA", (q) => q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount, status, paid_at, paid_amount, bank_account_id)
      values ('t3', 'tA', 'PAGAR', 'co_light', 'x', '2026-11-01', 10, 'PAGO', '2026-11-01', 10, 'acc_tA')`)), /outra empresa do grupo/);
  });
  it("lançamento baixado não se exclui (estorne antes)", async () => {
    await asTenant("tA", (q) => q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount, status, paid_at, paid_amount, bank_account_id, category_id)
      values ('t4', 'tA', 'PAGAR', 'co_tA', 'Salário', '2026-11-05', 1000, 'PAGO', '2026-11-05', 1000, 'acc_tA', 'cat_tA')`));
    await rejects(asTenant("tA", (q) => q(`delete from fin_titles where id = 't4'`)), /estorne a baixa/);
  });
  it("uma mensalidade por aluno e competência", async () => {
    await asTenant("tA", async (q) => {
      await q(`insert into students (id, tenant_id, company_id, name, monthly_fee) values ('s1', 'tA', 'co_tA', 'Enzo', 900)`);
      await q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount, student_id, competence, origin_type) values ('m1', 'tA', 'RECEBER', 'co_tA', 'Mens.', '2026-12-10', 900, 's1', '2026-12', 'MENSALIDADE')`);
    });
    await rejects(asTenant("tA", (q) => q(`insert into fin_titles (id, tenant_id, kind, company_id, description, due_date, amount, student_id, competence, origin_type) values ('m2', 'tA', 'RECEBER', 'co_tA', 'Mens.', '2026-12-10', 900, 's1', '2026-12', 'MENSALIDADE')`)), /fin_titles_tuition_uq/);
  });
  it("desconto não passa da mensalidade", async () => {
    await rejects(asTenant("tA", (q) => q(`insert into students (id, tenant_id, company_id, name, monthly_fee, discount) values ('s2', 'tA', 'co_tA', 'Ana', 100, 150)`)), /students_fee_ck/);
  });
});

describe("regras de usuários no banco", () => {
  it("conta master não pode ser desativada nem excluída", async () => {
    await rejects(db.query(`update users set status = 'INACTIVE' where id = 'm'`), /master/);
    await rejects(db.query(`delete from users where id = 'm'`), /master/);
  });
  it("sempre sobra um administrador ativo no cliente", async () => {
    await rejects(db.query(`update users set role = 'TENANT_USER' where id = 'a1'`), /ao menos um administrador/);
  });
  it("usuário não muda de cliente", async () => {
    await db.query(`insert into users (id, tenant_id, name, email, password_hash, role) values ('u1', 'tA', 'U', 'u@x.com', '${HASH}', 'TENANT_USER')`);
    await rejects(db.query(`update users set tenant_id = 'tB' where id = 'u1'`), /mudar de empresa/);
  });
  it("senha nunca fica sem hash bcrypt", async () => {
    await rejects(db.query(`update users set password_hash = '' where id = 'u1'`), /users_password_hash_ck/);
  });
  it("2FA só para administradores do sistema", async () => {
    await rejects(db.query(`update users set totp_secret = 'x', totp_enabled_at = now() where id = 'u1'`), /users_totp_scope_ck/);
  });
  it("módulos do cliente só do catálogo", async () => {
    await rejects(db.query(`update tenants set modules = '{financeiro,estoque}' where id = 'tA'`), /tenants_modules_ck/);
  });
});
