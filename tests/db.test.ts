/**
 * Testes de banco: aplica as migrações num PostgreSQL em memória (PGlite) e confere que as regras
 * críticas valem no próprio banco (gatilhos, CHECKs e chaves), mesmo sem passar pelo código.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const HASH = "$2b$12$opd9debQNUhrElkU44mKh.Ohe6/IWyv0jNqxU8ObcXDiY3Ib3REeq";
const rejects = async (p: Promise<unknown>, msg: RegExp) => { await expect(p).rejects.toThrow(msg); };

beforeAll(async () => {
  db = await PGlite.create();
  const dir = path.join(__dirname, "..", "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.exec(stmt);
  }
  await db.exec(`
    insert into users (id, name, email, password_hash, role) values
      ('m', 'Master', 'm@x.com', '${HASH}', 'SUPER_ADMIN'), ('a1', 'Admin', 'a@x.com', '${HASH}', 'ADMIN');
    update users set is_master = true where id = 'm';
    insert into companies (id, name) values ('co', 'Bee School'), ('co_light', 'Bee Light');
    insert into bank_accounts (id, company_id, name) values ('acc', 'co', 'Sicredi 1');
    insert into dre_groups (id, name, section) values ('g', 'Despesas com Pessoal', 'OPERACIONAL');
    insert into fin_categories (id, name, group_id) values ('cat', 'Salários', 'g');
  `);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("configuração do sistema (linha única)", () => {
  it("a migração já cria a linha padrão", async () => {
    const r = await db.query<{ id: string; status: string }>("select id, status from system_settings");
    expect(r.rows).toEqual([{ id: "main", status: "ACTIVE" }]);
  });
  it("não aceita uma segunda linha", async () => {
    await rejects(db.query(`insert into system_settings (id) values ('outra')`), /system_settings_single/);
  });
  it("módulos só do catálogo", async () => {
    await rejects(db.query(`update system_settings set modules = '{financeiro,estoque}'`), /system_settings_modules_ck/);
  });
});

describe("regras do financeiro no banco", () => {
  it("chave estrangeira impede apontar para cadastro inexistente", async () => {
    await rejects(db.query(`insert into bank_accounts (id, company_id, name) values ('acc_x', 'nao_existe', 'Conta X')`), /foreign key/);
  });
  it("baixa exige data, valor e conta", async () => {
    await rejects(db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount, status) values ('t1', 'PAGAR', 'co', 'x', '2026-11-01', 10, 'PAGO')`), /fin_titles_paid_ck/);
  });
  it("valor precisa ser positivo", async () => {
    await rejects(db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount) values ('t2', 'PAGAR', 'co', 'x', '2026-11-01', 0)`), /fin_titles_amount_ck/);
  });
  it("conta de outra empresa do grupo é recusada", async () => {
    await rejects(db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount, status, paid_at, paid_amount, bank_account_id)
      values ('t3', 'PAGAR', 'co_light', 'x', '2026-11-01', 10, 'PAGO', '2026-11-01', 10, 'acc')`), /outra empresa do grupo/);
  });
  it("lançamento baixado não se exclui (estorne antes)", async () => {
    await db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount, status, paid_at, paid_amount, bank_account_id, category_id)
      values ('t4', 'PAGAR', 'co', 'Salário', '2026-11-05', 1000, 'PAGO', '2026-11-05', 1000, 'acc', 'cat')`);
    await rejects(db.query(`delete from fin_titles where id = 't4'`), /estorne a baixa/);
  });
  it("uma mensalidade por aluno e competência", async () => {
    await db.query(`insert into students (id, company_id, name, monthly_fee) values ('s1', 'co', 'Enzo', 900)`);
    await db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount, student_id, competence, origin_type) values ('m1', 'RECEBER', 'co', 'Mens.', '2026-12-10', 900, 's1', '2026-12', 'MENSALIDADE')`);
    await rejects(db.query(`insert into fin_titles (id, kind, company_id, description, due_date, amount, student_id, competence, origin_type) values ('m2', 'RECEBER', 'co', 'Mens.', '2026-12-10', 900, 's1', '2026-12', 'MENSALIDADE')`), /fin_titles_tuition_uq/);
  });
  it("desconto não passa da mensalidade", async () => {
    await rejects(db.query(`insert into students (id, company_id, name, monthly_fee, discount) values ('s2', 'co', 'Ana', 100, 150)`), /students_fee_ck/);
  });
});

describe("regras de usuários no banco", () => {
  it("conta master não pode ser desativada nem excluída", async () => {
    await rejects(db.query(`update users set status = 'INACTIVE' where id = 'm'`), /master/);
    await rejects(db.query(`delete from users where id = 'm'`), /master/);
  });
  it("sempre sobra um administrador ativo na escola", async () => {
    await rejects(db.query(`update users set role = 'USER' where id = 'a1'`), /ao menos um administrador/);
  });
  it("conta do console e conta da escola são separadas", async () => {
    await db.query(`insert into users (id, name, email, password_hash, role) values ('u1', 'U', 'u@x.com', '${HASH}', 'USER')`);
    await rejects(db.query(`update users set role = 'SUPER_ADMIN' where id = 'u1'`), /conta do console/);
    // o mesmo e-mail pode existir no console e na escola, mas não duas vezes na mesma área
    await db.query(`insert into users (id, name, email, password_hash, role) values ('c2', 'U console', 'u@x.com', '${HASH}', 'SUPER_ADMIN')`);
    await rejects(db.query(`insert into users (id, name, email, password_hash, role) values ('u2', 'U2', 'u@x.com', '${HASH}', 'ADMIN')`), /users_app_email_uq/);
  });
  it("senha nunca fica sem hash bcrypt", async () => {
    await rejects(db.query(`update users set password_hash = '' where id = 'u1'`), /users_password_hash_ck/);
  });
  it("perfil excluído deixa o usuário sem perfil", async () => {
    await db.query(`insert into access_profiles (id, name) values ('p1', 'Secretaria')`);
    await db.query(`update users set profile_id = 'p1' where id = 'u1'`);
    await db.query(`delete from access_profiles where id = 'p1'`);
    const r = await db.query<{ profile_id: string | null }>(`select profile_id from users where id = 'u1'`);
    expect(r.rows[0].profile_id).toBeNull();
  });
});
