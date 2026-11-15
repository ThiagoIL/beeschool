-- Bee School — regras críticas aplicadas pelo próprio banco e isolamento por cliente (RLS com FORCE).
-- Mesmo que o código da aplicação tenha um erro, o PostgreSQL recusa a operação.

-- 1) Coerência dos usuários ------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_role_scope_ck" CHECK (
  ("role" = 'SUPER_ADMIN' AND "tenant_id" IS NULL) OR ("role" <> 'SUPER_ADMIN' AND "tenant_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_master_is_super_ck" CHECK (NOT "is_master" OR "role" = 'SUPER_ADMIN');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_ck" CHECK ("password_hash" ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_ck" CHECK ("email" = lower("email") AND "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_totp_scope_ck" CHECK ("totp_enabled_at" IS NULL OR ("role" = 'SUPER_ADMIN' AND "totp_secret" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_master_uq" ON "users" ("is_master") WHERE "is_master";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_ck" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_grace_ck" CHECK ("grace_days" BETWEEN 0 AND 90);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_modules_ck" CHECK ("modules" <@ ARRAY['financeiro','paineis','academico']::text[]);--> statement-breakpoint

-- 2) Proteção da conta master e dos administradores -------------------------------------
CREATE OR REPLACE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  restantes integer;
BEGIN
  -- serializa alterações de administradores do mesmo escopo (evita corrida entre duas requisições)
  PERFORM pg_advisory_xact_lock(hashtext('users_guard:' || coalesce(OLD.tenant_id, 'sistema')));

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_master THEN
      RAISE EXCEPTION 'ERP_RULE: a conta master do sistema não pode ser excluída' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'ERP_RULE: um usuário não pode mudar de empresa' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_master THEN
      IF NOT NEW.is_master THEN
        RAISE EXCEPTION 'ERP_RULE: a conta master não pode perder a proteção de master' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.role <> 'SUPER_ADMIN' THEN
        RAISE EXCEPTION 'ERP_RULE: a conta master não pode deixar de ser administradora do sistema' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'ERP_RULE: a conta master não pode ser desativada' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- sempre deve sobrar ao menos um administrador ativo no sistema e no cliente
  IF OLD.status = 'ACTIVE' AND OLD.role IN ('SUPER_ADMIN', 'TENANT_ADMIN')
     AND (TG_OP = 'DELETE' OR NEW.status <> 'ACTIVE' OR NEW.role <> OLD.role) THEN
    SELECT count(*) INTO restantes FROM users
     WHERE id <> OLD.id AND role = OLD.role AND status = 'ACTIVE'
       AND tenant_id IS NOT DISTINCT FROM OLD.tenant_id;
    IF restantes = 0 THEN
      RAISE EXCEPTION 'ERP_RULE: é preciso manter ao menos um administrador ativo' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_guard_trg" BEFORE UPDATE OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION users_guard();--> statement-breakpoint

-- 3) Regras do financeiro e do acadêmico ------------------------------------------------
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_kind_ck" CHECK ("kind" IN ('BANCO', 'CAIXA', 'APLICACAO'));--> statement-breakpoint
ALTER TABLE "dre_groups" ADD CONSTRAINT "dre_groups_section_ck" CHECK ("section" IN ('RECEITA', 'DEDUCAO', 'VARIAVEL', 'OPERACIONAL', 'INVESTIMENTO'));--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_pct_ck" CHECK ("pct_base" IN ('MENSALIDADE', 'RECEITA_BRUTA'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_color_ck" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$');--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_status_ck" CHECK ("status" IN ('ATIVO', 'TRANCADO', 'CANCELADO', 'CONCLUIDO'));--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_fee_ck" CHECK ("monthly_fee" >= 0 AND "discount" >= 0 AND "discount" <= "monthly_fee");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_due_day_ck" CHECK ("due_day" BETWEEN 1 AND 28);--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_year_ck" CHECK ("year" BETWEEN 2000 AND 2100 AND ("capacity" IS NULL OR "capacity" >= 0));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_kind_ck" CHECK ("kind" IN ('RECEBER', 'PAGAR'));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_status_ck" CHECK ("status" IN ('ABERTO', 'PAGO', 'CANCELADO'));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_origin_ck" CHECK ("origin_type" IN ('MANUAL', 'MENSALIDADE', 'IMPORTACAO'));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_amount_ck" CHECK ("amount" > 0 AND ("paid_amount" IS NULL OR "paid_amount" >= 0));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_invoice_ck" CHECK ("invoice" IS NULL OR "invoice" IN ('COM', 'SEM'));--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_competence_ck" CHECK ("competence" IS NULL OR "competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
-- baixado = tem data, valor e conta; em aberto ou cancelado = sem dados de baixa
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_paid_ck" CHECK (
  ("status" = 'PAGO' AND "paid_at" IS NOT NULL AND "paid_amount" IS NOT NULL AND "bank_account_id" IS NOT NULL)
  OR ("status" <> 'PAGO' AND "paid_at" IS NULL AND "paid_amount" IS NULL)
);--> statement-breakpoint
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_amount_ck" CHECK ("amount" <> 0);--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_pct_ck" CHECK ("target_pct" >= 0 AND "target_pct" <= 1000);--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_source_ck" CHECK ("group_id" IS NOT NULL OR cardinality("category_ids") > 0);--> statement-breakpoint

-- Lançamento com conta precisa ser da mesma empresa da conta; lançamento baixado (não importado) não se exclui
CREATE OR REPLACE FUNCTION fin_titles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  emp text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PAGO' AND OLD.origin_type <> 'IMPORTACAO' THEN
      RAISE EXCEPTION 'ERP_RULE: estorne a baixa antes de excluir o lançamento' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.bank_account_id IS NOT NULL THEN
    SELECT company_id INTO emp FROM bank_accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.bank_account_id;
    IF emp IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'ERP_RULE: a conta escolhida é de outra empresa do grupo' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "fin_titles_guard_trg" BEFORE INSERT OR UPDATE OR DELETE ON "fin_titles" FOR EACH ROW EXECUTE FUNCTION fin_titles_guard();--> statement-breakpoint

-- Perfil de acesso do usuário sempre do mesmo cliente (FK composta; ao excluir o perfil, só profile_id fica nulo)
ALTER TABLE "users" ADD CONSTRAINT "users_profile_fk" FOREIGN KEY ("tenant_id", "profile_id") REFERENCES "access_profiles" ("tenant_id", "id") ON DELETE SET NULL ("profile_id");--> statement-breakpoint

-- 4) Isolamento por cliente com Row Level Security --------------------------------------
-- A aplicação acessa as tabelas de negócio com o papel erp_app (NOBYPASSRLS) numa transação que informa
-- o cliente em app.tenant_id (withTenant em src/lib/db.ts). FORCE faz valer também para o dono da tabela.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT erp_app TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_app;--> statement-breakpoint
GRANT SELECT ON "tenants" TO erp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sequences", "access_profiles", "company_settings", "companies", "bank_accounts", "dre_groups", "fin_categories", "payment_methods", "fin_situations", "people", "classes", "students", "fin_imports", "fin_titles", "bank_entries", "indicators", "indicator_targets" TO erp_app;--> statement-breakpoint
ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sequences" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "access_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "access_profiles" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_settings" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "companies" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_accounts" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "dre_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dre_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dre_groups" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "fin_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fin_categories" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_methods" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "fin_situations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin_situations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fin_situations" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "people" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "classes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "classes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "classes" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "students" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "students" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "fin_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fin_imports" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "fin_titles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin_titles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fin_titles" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "bank_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_entries" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "indicators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "indicators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "indicators" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "indicator_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "indicator_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "indicator_targets" USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
