# Bee School — contexto para o Claude Code

Mantenha este arquivo atualizado ao final de cada sessão (decisões e próximos passos).

## O que é
Sistema de gestão escolar da Bee Christian School e da Be Light Christian School (cliente do João / Otimiza+
Gestão). Começa pelo **financeiro** (a lógica das planilhas por banco + o Power BI "Visão Financeira") e traz
as primeiras seções acadêmicas para substituir o Proesc aos poucos. Interface em português do Brasil.
**Sistema de uma escola só, sem multi-tenant** (decisão do João, nov/2026): um deploy, um banco. O console do
fornecedor fica no mesmo domínio em `/sistema-admin`, com login e contas separados, como na Clínica Bosque.
Base de código derivada do Otimiza+ ERP (`D:\CLAUDE\otimiza-erp`).

## Stack
Next.js 15 (App Router + Server Actions) · React 19 · TypeScript · PostgreSQL 16 · Drizzle ORM · Zod · Vitest ·
nodemailer · qrcode · CSS próprio (`src/app/globals.css`, paleta dourado #E9AE20 / preto / cinza, fundo creme).

## Regras de arquitetura (não quebrar)
- Sem `tenant_id`. Configuração do fornecedor (licença, bloqueio, módulos, plano) na linha única
  `system_settings` (`getSystem()`); dados da instituição em `company_settings` (linha única).
- Páginas: `const s = await page("modulo")`, `s.tx(...)` (transação); ações: `const s = await act("modulo")`.
- Tabela nova: declarar em `src/db/erp.ts`, `npm run db:generate`; CHECKs/gatilhos numa migração `--custom`
  (modelo `drizzle/0001_regras.sql`). Nunca editar migração aplicada.
- Áreas: o middleware reescreve `PLATFORM_ADMIN_PATH` (padrão `/sistema-admin`) para `src/app/console/*` e grava
  o header `x-bee-area`; `requestArea()` lê esse header. Links do console sempre com `consoleHref()`
  (`src/lib/console-path.ts`). Contas `SUPER_ADMIN` = console; `ADMIN`/`USER` = escola; cookies separados.
- Módulos, níveis (`NONE/VIEW/EDIT`), rotas e menu: `src/lib/modules.ts` (sem dependências de servidor; usado
  no middleware). Acesso: `computeAccess` (puro) + `loadAccess` em `src/lib/session-core.ts`.
- `src/lib/session-core.ts`, `db.ts` e `env.ts` **não** importam `server-only` (o middleware usa).
- Arquivos `"use server"` só exportam funções async (tipos podem).
- Dinheiro `numeric(14,2)`; datas de negócio `AAAA-MM-DD`.

## Lógica financeira
- Empresas (`companies`) → contas (`bank_accounts`, uma por banco/empresa) → lançamentos (`fin_titles`,
  RECEBER/PAGAR; PAGO = movimento realizado no extrato). Transferências/ajustes: `bank_entries` (fora da DRE).
- Categoria (`fin_categories`) → grupo da DRE (`dre_groups`, seção RECEITA/DEDUCAO/VARIAVEL/OPERACIONAL/
  INVESTIMENTO; `is_base` = faturamento base dos %). Plano padrão em `DEFAULT_PLAN` (`src/server/common.ts`).
- DRE em `src/lib/dre.ts` (regime de caixa, % AH sobre |anterior|, % sobre a base). Conferida com o painel.
- Mensalidades: `generateTuitionAction` (índice único aluno+competência). Importação: `importStatementAction`
  (layout Data/Descrição/Entrada/Saída/Classificação/Nota; prévia, duplicados, desfazer por `fin_imports`).
- Indicadores (`indicators`) + metas por empresa (`indicator_targets`).

## Onde fica cada coisa
- Telas: `src/views/app/finance.tsx`, `panels.tsx`, `home.tsx`, `admin.tsx`; console `src/views/admin/*` (rotas em `src/app/console`).
- Cadastros simples (empresas, contas, grupos, categorias, formas, situações, pessoas, alunos, turmas,
  responsáveis): `src/server/simple-registry.ts` + `SimplePage`/`SimpleCrud`.
- Segurança: `src/lib/session*.ts`, `context.ts`, `access.ts`, `license.ts`, `totp.ts`, `mail.ts`, `console-path.ts`, `middleware.ts`.
- Exportações CSV: `src/server/exports.ts` (`/api/export/<tipo>`).

## Comandos
`npm run typecheck` · `npm test` (inclui `tests/db.test.ts` com PGlite) · `npm run db:dev` (PGlite na porta 5433,
use `DATABASE_POOL_MAX=1`) · `npm run db:migrate` · `npm run db:bootstrap` · `DEMO=1 npm run db:seed-demo`.

## Decisões (nov/2026)
- Sem multi-tenant; bootstrap cria a conta master do console (`PLATFORM_ADMIN_*`) e o 1º admin da escola (`ADMIN_*`).
- Variáveis obrigatórias: só `DATABASE_URL` e `AUTH_SECRET` (cifra o 2FA; nunca trocar depois de em uso).
- 2FA no console é opcional (pedido do João, nov/2026): cada admin ativa em Minha conta; quem ativou passa a
  digitar o código. Para obrigar de novo: `twoFactorRequired: true` em `src/lib/env.ts`.
- Bloqueio automático: `paid_until` + `grace_days`; manual com `block_message` (em `system_settings`). Tela `/suspenso`.
- Grupo de receitas padrão renomeado para "Outras receitas" (a linha calculada é "Receita Bruta").
- Contas padrão criadas por suposição (Bee School: Inter, C6, Cora, Itaú, Sicredi 1/2, Nordeste, Caixa;
  Bee Light: Cora, Sicredi 1/2) e metas padrão só para a Bee Light (lidas do print do Power BI) — conferir com o cliente.
- A Receita Líquida do painel antigo tem uma diferença (~R$ 728 em set) para Receita Bruta − Impostos; o sistema
  usa a fórmula direta. Confirmar com o cliente o que mais o Power BI desconta.

## Próximos passos sugeridos
- Integração com o Proesc (alunos e mensalidades) e conciliação bancária por OFX.
- Boletos/PIX para mensalidades; régua de cobrança.
- Mais seções acadêmicas (frequência, notas, matrícula online).
