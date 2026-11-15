CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_USER');--> statement-breakpoint
CREATE TYPE "public"."session_area" AS ENUM('ADMIN', 'TENANT');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"user_email" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text,
	"area" "session_area" NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"status" "tenant_status" DEFAULT 'ACTIVE' NOT NULL,
	"block_message" text,
	"paid_until" date,
	"grace_days" integer DEFAULT 5 NOT NULL,
	"modules" text[] DEFAULT '{financeiro,paineis,academico}'::text[] NOT NULL,
	"notes" text,
	"max_users" integer,
	"max_sessions" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_master" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"profile_id" text,
	"totp_secret" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" integer,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "access_profiles_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'BANCO' NOT NULL,
	"bank" text,
	"agency" text,
	"account" text,
	"initial_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"initial_date" date,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "bank_accounts_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bank_account_id" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"transfer_id" text,
	"notes" text,
	CONSTRAINT "bank_entries_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"shift" text,
	"year" integer NOT NULL,
	"capacity" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "classes_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"color" text DEFAULT '#E9AE20' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "companies_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legal_name" text,
	"trade_name" text,
	"document" text,
	"phone" text,
	"email" text,
	"city" text,
	"uf" text,
	"logo" text,
	"logo_mime" text,
	"logo_at" timestamp with time zone,
	"pct_base" text DEFAULT 'MENSALIDADE' NOT NULL,
	"defaults_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "company_settings_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "dre_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "dre_groups_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fin_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"group_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fin_categories_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fin_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bank_account_id" text NOT NULL,
	"file_name" text NOT NULL,
	"rows" integer NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"user_name" text,
	CONSTRAINT "fin_imports_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fin_situations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6B6B6B' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fin_situations_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fin_titles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"company_id" text NOT NULL,
	"description" text NOT NULL,
	"document" text,
	"person_id" text,
	"student_id" text,
	"category_id" text,
	"issue_date" date,
	"due_date" date NOT NULL,
	"competence" text,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'ABERTO' NOT NULL,
	"paid_at" date,
	"paid_amount" numeric(14, 2),
	"payment_method_id" text,
	"bank_account_id" text,
	"situation_id" text,
	"invoice" text,
	"installment" text,
	"origin_type" text DEFAULT 'MANUAL' NOT NULL,
	"origin_id" text,
	"notes" text,
	"user_name" text,
	CONSTRAINT "fin_titles_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "indicator_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"indicator_id" text NOT NULL,
	"company_id" text NOT NULL,
	"target_pct" numeric(7, 2) NOT NULL,
	CONSTRAINT "indicator_targets_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"group_id" text,
	"category_ids" text[] DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "indicators_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payment_methods_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kinds" text[] DEFAULT '{}' NOT NULL,
	"document" text,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "people_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sequences_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"birth_date" date,
	"class_id" text,
	"guardian_id" text,
	"status" text DEFAULT 'ATIVO' NOT NULL,
	"monthly_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"due_day" integer DEFAULT 10 NOT NULL,
	"external_code" text,
	"notes" text,
	CONSTRAINT "students_tid_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_bank_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dre_groups" ADD CONSTRAINT "dre_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."dre_groups"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_imports" ADD CONSTRAINT "fin_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_imports" ADD CONSTRAINT "fin_imports_bank_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_situations" ADD CONSTRAINT "fin_situations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_cat_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."fin_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_pm_fk" FOREIGN KEY ("tenant_id","payment_method_id") REFERENCES "public"."payment_methods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_bank_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_titles" ADD CONSTRAINT "fin_titles_sit_fk" FOREIGN KEY ("tenant_id","situation_id") REFERENCES "public"."fin_situations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_ind_fk" FOREIGN KEY ("tenant_id","indicator_id") REFERENCES "public"."indicators"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."dre_groups"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_fk" FOREIGN KEY ("tenant_id","class_id") REFERENCES "public"."classes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "users" USING btree ("tenant_id","email") WHERE "users"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_system_email_uq" ON "users" USING btree ("email") WHERE "users"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_profiles_name_uq" ON "access_profiles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_name_uq" ON "bank_accounts" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_name_uq" ON "classes" USING btree ("tenant_id","year","name");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_uq" ON "companies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_tenant_uq" ON "company_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dre_groups_name_uq" ON "dre_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_categories_name_uq" ON "fin_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "fin_titles_due_idx" ON "fin_titles" USING btree ("tenant_id","kind","due_date");--> statement-breakpoint
CREATE INDEX "fin_titles_paid_idx" ON "fin_titles" USING btree ("tenant_id","status","paid_at");--> statement-breakpoint
CREATE INDEX "fin_titles_origin_idx" ON "fin_titles" USING btree ("tenant_id","origin_type","origin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_titles_tuition_uq" ON "fin_titles" USING btree ("tenant_id","student_id","competence") WHERE origin_type = 'MENSALIDADE' and status <> 'CANCELADO';--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_targets_uq" ON "indicator_targets" USING btree ("tenant_id","indicator_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_name_uq" ON "payment_methods" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "students_name_idx" ON "students" USING btree ("tenant_id","name");