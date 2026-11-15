-- 2FA do console removido por enquanto (pode voltar no futuro com uma migração nova).
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_totp_scope_ck";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_enabled_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_last_step";--> statement-breakpoint
-- os tokens passam a ser guardados como HMAC com o AUTH_SECRET: as sessões e links antigos deixam de valer
DELETE FROM "sessions";--> statement-breakpoint
DELETE FROM "password_resets";
