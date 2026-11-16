ALTER TABLE "fin_categories" ADD COLUMN "kind" text DEFAULT 'PAGAR' NOT NULL;--> statement-breakpoint
-- categorias já cadastradas: as dos grupos de receita viram "Receita"; as demais ficam "Despesa" (ajustáveis em Configurações › Categorias)
UPDATE "fin_categories" c SET "kind" = 'RECEBER' FROM "dre_groups" g WHERE g."id" = c."group_id" AND g."section" = 'RECEITA';--> statement-breakpoint
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_kind_ck" CHECK ("kind" IN ('RECEBER', 'PAGAR'));
