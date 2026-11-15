-- Bee School — regras críticas aplicadas pelo próprio banco.
-- Mesmo que o código da aplicação tenha um erro, o PostgreSQL recusa a operação.

-- 1) Coerência dos usuários e da configuração do sistema --------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_master_is_super_ck" CHECK (NOT "is_master" OR "role" = 'SUPER_ADMIN');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_ck" CHECK ("password_hash" ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_ck" CHECK ("email" = lower("email") AND "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');--> statement-breakpoint
-- 2FA só no console
ALTER TABLE "users" ADD CONSTRAINT "users_totp_scope_ck" CHECK ("totp_enabled_at" IS NULL OR ("role" = 'SUPER_ADMIN' AND "totp_secret" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_master_uq" ON "users" ("is_master") WHERE "is_master";--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_grace_ck" CHECK ("grace_days" BETWEEN 0 AND 90);--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_modules_ck" CHECK ("modules" <@ ARRAY['financeiro','paineis','academico']::text[]);--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_limits_ck" CHECK (("max_users" IS NULL OR "max_users" >= 1) AND ("max_sessions" IS NULL OR "max_sessions" >= 1));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_area_ck" CHECK ("area" IN ('CONSOLE', 'APP'));--> statement-breakpoint
INSERT INTO "system_settings" ("id", "name") VALUES ('main', 'Bee School & Bee Light') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "company_settings" ("id") VALUES ('main') ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 2) Proteção da conta master e dos administradores -------------------------------------
CREATE OR REPLACE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  restantes integer;
BEGIN
  -- serializa alterações de administradores (evita corrida entre duas requisições)
  PERFORM pg_advisory_xact_lock(hashtext('users_guard'));

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_master THEN
      RAISE EXCEPTION 'ERP_RULE: a conta master do console não pode ser excluída' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- contas do console e da escola são separadas: não se troca de uma para a outra
    IF (NEW.role = 'SUPER_ADMIN') <> (OLD.role = 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'ERP_RULE: uma conta do console não pode virar conta da escola, nem o contrário' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_master THEN
      IF NOT NEW.is_master THEN
        RAISE EXCEPTION 'ERP_RULE: a conta master não pode perder a proteção de master' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'ERP_RULE: a conta master não pode ser desativada' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- sempre deve sobrar ao menos um administrador ativo no console e na escola
  IF OLD.status = 'ACTIVE' AND OLD.role IN ('SUPER_ADMIN', 'ADMIN')
     AND (TG_OP = 'DELETE' OR NEW.status <> 'ACTIVE' OR NEW.role <> OLD.role) THEN
    SELECT count(*) INTO restantes FROM users
     WHERE id <> OLD.id AND role = OLD.role AND status = 'ACTIVE';
    IF restantes = 0 THEN
      RAISE EXCEPTION 'ERP_RULE: é preciso manter ao menos um administrador ativo' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_guard_trg" BEFORE UPDATE OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION users_guard();--> statement-breakpoint

-- Perfil de acesso do usuário (ao excluir o perfil, o usuário fica sem perfil)
ALTER TABLE "users" ADD CONSTRAINT "users_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "access_profiles" ("id") ON DELETE SET NULL;--> statement-breakpoint

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
    SELECT company_id INTO emp FROM bank_accounts WHERE id = NEW.bank_account_id;
    IF emp IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'ERP_RULE: a conta escolhida é de outra empresa do grupo' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "fin_titles_guard_trg" BEFORE INSERT OR UPDATE OR DELETE ON "fin_titles" FOR EACH ROW EXECUTE FUNCTION fin_titles_guard();
