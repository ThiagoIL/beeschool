/**
 * Bee School — tabelas de negócio (financeiro, acadêmico e painéis).
 *
 * Padrões:
 *  - sistema de uma escola só: as tabelas não têm tenant_id (ver src/db/schema.ts);
 *  - chaves estrangeiras explícitas, regras de valores em CHECKs e gatilhos (migração 0001);
 *  - datas de negócio são `date` em texto AAAA-MM-DD; dinheiro em numeric(14,2) (nunca float).
 *
 * Lógica financeira (a mesma das planilhas e dos painéis do cliente):
 *  - o grupo tem várias EMPRESAS (Bee School, Bee Light); cada CONTA (banco ou caixa) é de uma empresa;
 *  - cada lançamento tem uma CATEGORIA, e cada categoria pertence a um GRUPO DA DRE
 *    (Receita Bruta, Despesas com Pessoal, Ocupação…);
 *  - a DRE soma os lançamentos realizados com sinal (entrada +, saída −) por grupo e calcula
 *    Receita Líquida, Margem Bruta, Resultado Operacional e Resultado Final Gerencial pela seção do grupo.
 */
import {
  boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex,
  type AnyPgColumn, type PgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "../lib/ids";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** Colunas comuns a toda tabela de negócio. */
const base = () => ({
  id: text("id").primaryKey().$defaultFn(createId),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Chave estrangeira simples coluna → id. `cascade` apaga junto; sem ele o banco impede apagar o registro usado. */
function fk(name: string, col: PgColumn, ref: () => { id: AnyPgColumn }, cascade = false) {
  const f = foreignKey({ name, columns: [col], foreignColumns: [ref().id] });
  return cascade ? f.onDelete("cascade") : f;
}

// =====================================================================================
// Administração
// =====================================================================================
export const sequences = pgTable("sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

export const accessProfiles = pgTable("access_profiles", {
  ...base(),
  name: text("name").notNull(),
  description: text("description"),
  /** { financeiro: "EDIT" | "VIEW" | "NONE", … } */
  permissions: jsonb("permissions").$type<Record<string, string>>().notNull().default({}),
}, (t) => [uniqueIndex("access_profiles_name_uq").on(t.name)]);

/** Dados da instituição e preferências (linha única, id = 'main'), editados pela própria escola. */
export const companySettings = pgTable("company_settings", {
  id: text("id").primaryKey().default("main"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  legalName: text("legal_name"),
  tradeName: text("trade_name"),
  document: text("document"),
  phone: text("phone"),
  email: text("email"),
  city: text("city"),
  uf: text("uf"),
  logo: text("logo"),
  logoMime: text("logo_mime"),
  logoAt: ts("logo_at"),
  /** base do "% sobre o faturamento" nos painéis: MENSALIDADE (grupos marcados como base) ou RECEITA_BRUTA */
  pctBase: text("pct_base").notNull().default("MENSALIDADE"),
  defaultsVersion: integer("defaults_version").notNull().default(0),
}, (t) => [check("company_settings_single", sql`${t.id} = 'main'`)]);

// =====================================================================================
// Estrutura financeira
// =====================================================================================
/** Empresas do grupo (ex.: Bee School e Bee Light). */
export const companies = pgTable("companies", {
  ...base(),
  name: text("name").notNull(),
  document: text("document"),
  color: text("color").notNull().default("#E9AE20"),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("companies_name_uq").on(t.name)]);

/** Contas: bancos (Sicredi 1, Cora, Inter…), caixa em dinheiro e aplicações. Cada uma é de uma empresa. */
export const bankAccounts = pgTable("bank_accounts", {
  ...base(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("BANCO"), // BANCO | CAIXA | APLICACAO
  bank: text("bank"),
  agency: text("agency"),
  account: text("account"),
  initialBalance: money("initial_balance").notNull().default("0"),
  initialDate: day("initial_date"),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("bank_accounts_name_uq").on(t.name),
  fk("bank_accounts_company_fk", t.companyId, () => companies)]);

/**
 * Grupos da DRE. A seção define onde o grupo entra no cálculo:
 *   RECEITA → Receita Bruta; DEDUCAO → (=) Receita Líquida; VARIAVEL → (=) Margem Bruta;
 *   OPERACIONAL → (=) Resultado Operacional; INVESTIMENTO → (=) Resultado Final Gerencial.
 * isBase marca os grupos que formam o "faturamento" (base dos percentuais; padrão: Mensalidade).
 */
export const dreGroups = pgTable("dre_groups", {
  ...base(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  position: integer("position").notNull().default(0),
  isBase: boolean("is_base").notNull().default(false),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("dre_groups_name_uq").on(t.name)]);

/** Categorias dos lançamentos (Salários e ordenados, Matrícula, Energia elétrica…), ligadas a um grupo da DRE. */
export const finCategories = pgTable("fin_categories", {
  ...base(),
  name: text("name").notNull(),
  groupId: text("group_id").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("fin_categories_name_uq").on(t.name),
  fk("fin_categories_group_fk", t.groupId, () => dreGroups)]);

export const paymentMethods = pgTable("payment_methods", {
  ...base(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("payment_methods_name_uq").on(t.name)]);

/** Situações auxiliares dos lançamentos em aberto (ex.: Aguardando aprovação, Agendado). */
export const finSituations = pgTable("fin_situations", {
  ...base(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6B6B6B"),
  active: boolean("active").notNull().default(true),
});

/** Pessoas: responsáveis financeiros, fornecedores, funcionários e prestadores. */
export const people = pgTable("people", {
  ...base(),
  name: text("name").notNull(),
  kinds: text("kinds").array().notNull().default([]),
  document: text("document"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
}, (t) => [index("people_name_idx").on(t.name)]);

// =====================================================================================
// Acadêmico (primeiras seções, no lugar do Proesc)
// =====================================================================================
export const classes = pgTable("classes", {
  ...base(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  level: text("level"),
  shift: text("shift"),
  year: integer("year").notNull(),
  capacity: integer("capacity"),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("classes_name_uq").on(t.year, t.name),
  fk("classes_company_fk", t.companyId, () => companies)]);

export const students = pgTable("students", {
  ...base(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  birthDate: day("birth_date"),
  classId: text("class_id"),
  guardianId: text("guardian_id"),
  status: text("status").notNull().default("ATIVO"), // ATIVO | TRANCADO | CANCELADO | CONCLUIDO
  /** valor cheio da mensalidade e desconto (bolsa, irmão…) em R$ */
  monthlyFee: money("monthly_fee").notNull().default("0"),
  discount: money("discount").notNull().default("0"),
  dueDay: integer("due_day").notNull().default(10),
  externalCode: text("external_code"), // código no Proesc
  notes: text("notes"),
}, (t) => [index("students_name_idx").on(t.name),
  fk("students_company_fk", t.companyId, () => companies),
  fk("students_class_fk", t.classId, () => classes),
  fk("students_guardian_fk", t.guardianId, () => people)]);

// =====================================================================================
// Lançamentos
// =====================================================================================
/** Importações de planilha (cada linha vira um lançamento realizado; dá para desfazer a importação inteira). */
export const finImports = pgTable("fin_imports", {
  ...base(),
  bankAccountId: text("bank_account_id").notNull(),
  fileName: text("file_name").notNull(),
  rows: integer("rows").notNull(),
  total: money("total").notNull().default("0"),
  userName: text("user_name"),
}, (t) => [fk("fin_imports_bank_fk", t.bankAccountId, () => bankAccounts)]);

/** Contas a receber e a pagar. Pago/recebido (status PAGO) = movimento realizado no extrato da conta. */
export const finTitles = pgTable("fin_titles", {
  ...base(),
  kind: text("kind").notNull(), // RECEBER | PAGAR
  companyId: text("company_id").notNull(),
  description: text("description").notNull(),
  document: text("document"),
  personId: text("person_id"),
  studentId: text("student_id"),
  categoryId: text("category_id"),
  issueDate: day("issue_date"),
  dueDate: day("due_date").notNull(),
  /** competência AAAA-MM (mensalidades) */
  competence: text("competence"),
  amount: money("amount").notNull(),
  status: text("status").notNull().default("ABERTO"), // ABERTO | PAGO | CANCELADO
  paidAt: day("paid_at"),
  paidAmount: money("paid_amount"),
  paymentMethodId: text("payment_method_id"),
  bankAccountId: text("bank_account_id"),
  situationId: text("situation_id"),
  /** nota fiscal: COM | SEM | nulo (coluna NOTA das planilhas) */
  invoice: text("invoice"),
  installment: text("installment"),
  originType: text("origin_type").notNull().default("MANUAL"), // MANUAL | MENSALIDADE | IMPORTACAO
  originId: text("origin_id"),
  notes: text("notes"),
  userName: text("user_name"),
}, (t) => [
  index("fin_titles_due_idx").on(t.kind, t.dueDate),
  index("fin_titles_paid_idx").on(t.status, t.paidAt),
  index("fin_titles_origin_idx").on(t.originType, t.originId),
  // uma mensalidade por aluno e competência (canceladas não contam)
  uniqueIndex("fin_titles_tuition_uq").on(t.studentId, t.competence).where(sql`origin_type = 'MENSALIDADE' and status <> 'CANCELADO'`),
  fk("fin_titles_company_fk", t.companyId, () => companies),
  fk("fin_titles_person_fk", t.personId, () => people),
  fk("fin_titles_student_fk", t.studentId, () => students),
  fk("fin_titles_cat_fk", t.categoryId, () => finCategories),
  fk("fin_titles_pm_fk", t.paymentMethodId, () => paymentMethods),
  fk("fin_titles_bank_fk", t.bankAccountId, () => bankAccounts),
  fk("fin_titles_sit_fk", t.situationId, () => finSituations),
]);

/** Lançamentos avulsos do extrato que não entram na DRE: transferências entre contas e ajustes de saldo. */
export const bankEntries = pgTable("bank_entries", {
  ...base(),
  bankAccountId: text("bank_account_id").notNull(),
  date: day("date").notNull(),
  description: text("description").notNull(),
  amount: money("amount").notNull(), // com sinal: + entrada, − saída
  transferId: text("transfer_id"),
  notes: text("notes"),
}, (t) => [fk("bank_entries_bank_fk", t.bankAccountId, () => bankAccounts, true)]);

// =====================================================================================
// Painéis: indicadores (% sobre o faturamento) e metas do orçamento por empresa
// =====================================================================================
export const indicators = pgTable("indicators", {
  ...base(),
  name: text("name").notNull(),
  /** soma um grupo inteiro da DRE… */
  groupId: text("group_id"),
  /** …ou categorias escolhidas */
  categoryIds: text("category_ids").array().notNull().default([]),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [fk("indicators_group_fk", t.groupId, () => dreGroups)]);

/** Meta (teto) do indicador em % do faturamento, por empresa (orçamento Bee School, orçamento Bee Light). */
export const indicatorTargets = pgTable("indicator_targets", {
  ...base(),
  indicatorId: text("indicator_id").notNull(),
  companyId: text("company_id").notNull(),
  targetPct: numeric("target_pct", { precision: 7, scale: 2 }).notNull(),
}, (t) => [uniqueIndex("indicator_targets_uq").on(t.indicatorId, t.companyId),
  fk("indicator_targets_ind_fk", t.indicatorId, () => indicators, true),
  fk("indicator_targets_company_fk", t.companyId, () => companies, true)]);

export type FinTitle = typeof finTitles.$inferSelect;
export type DreGroup = typeof dreGroups.$inferSelect;
