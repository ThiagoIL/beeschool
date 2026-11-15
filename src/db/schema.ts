/**
 * Bee School — modelo de dados do núcleo (Drizzle ORM / PostgreSQL)
 *
 * Instalação única: o sistema roda para um cliente (a escola), mas mantém a estrutura multi-tenant
 * padrão (tenants + RLS). O console do fornecedor (admin.<domínio>) bloqueia, libera e configura o cliente.
 *
 *  - Toda tabela de negócio tem tenant_id e é protegida por Row Level Security (RLS) com FORCE.
 *    O acesso só funciona dentro de withTenant() (src/lib/db.ts).
 *  - Regras críticas de usuários também estão em gatilhos no banco (migração 0001).
 *
 * Depois de alterar este arquivo, gere a migração com: npm run db:generate
 */
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId } from "../lib/ids";

export const roleEnum = pgEnum("role", ["SUPER_ADMIN", "TENANT_ADMIN", "TENANT_USER"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "INACTIVE"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["ACTIVE", "SUSPENDED"]);
export const sessionAreaEnum = pgEnum("session_area", ["ADMIN", "TENANT"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => text("id").primaryKey().$defaultFn(createId);

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(), // subdomínio: slug.ROOT_DOMAIN
  name: text("name").notNull(),
  document: text("document"),
  status: tenantStatusEnum("status").notNull().default("ACTIVE"),
  /** mensagem mostrada na tela "Acesso suspenso" */
  blockMessage: text("block_message"),
  /** licença paga até esta data (AAAA-MM-DD); nulo = sem vencimento */
  paidUntil: date("paid_until", { mode: "string" }),
  /** dias de tolerância depois do vencimento antes do bloqueio automático */
  graceDays: integer("grace_days").notNull().default(5),
  /** módulos liberados para o cliente (chaves de src/lib/modules.ts) */
  modules: text("modules").array().notNull().default(sql`'{financeiro,paineis,academico}'::text[]`),
  notes: text("notes"),
  maxUsers: integer("max_users"),
  maxSessions: integer("max_sessions"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const users = pgTable("users", {
  id: id(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "restrict" }), // nulo = administrador do sistema
  name: text("name").notNull(),
  email: text("email").notNull(), // sempre em minúsculas
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  isMaster: boolean("is_master").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** perfil de acesso aos módulos (access_profiles); nulo = acesso padrão */
  profileId: text("profile_id"),
  /** segredo TOTP (base32) cifrado; só administradores do sistema usam 2FA */
  totpSecret: text("totp_secret"),
  totpEnabledAt: ts("totp_enabled_at"),
  /** último passo TOTP aceito (evita reaproveitar o mesmo código) */
  totpLastStep: integer("totp_last_step"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  passwordChangedAt: ts("password_changed_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email).where(sql`${t.tenantId} is not null`),
  uniqueIndex("users_system_email_uq").on(t.email).where(sql`${t.tenantId} is null`),
  index("users_tenant_idx").on(t.tenantId),
]);

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 do token; o token só existe no cookie
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id"),
  area: sessionAreaEnum("area").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)]);

/** Pedidos de recuperação de senha por e-mail. Só o hash do token fica no banco. */
export const passwordResets = pgTable("password_resets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  ip: text("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("password_resets_user_idx").on(t.userId)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: ts("reset_at").notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  tenantId: text("tenant_id"),
  userId: text("user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(), // entidade.verbo
  entity: text("entity"),
  entityId: text("entity_id"),
  data: jsonb("data"),
  ip: text("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("audit_tenant_created_idx").on(t.tenantId, t.createdAt), index("audit_created_idx").on(t.createdAt)]);

// Tabelas de negócio (financeiro, acadêmico, painéis): src/db/erp.ts

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
