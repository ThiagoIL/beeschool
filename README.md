# Bee School

Sistema de gestão escolar da **Bee Christian School** e da **Be Light Christian School**, começando pelo
**financeiro**: contas a receber e a pagar, extrato por banco, fluxo de caixa, mensalidades, importação das
planilhas, DRE gerencial, painéis (Análise DRE, Fluxo de caixa, Indicadores com metas do orçamento) e
relatórios em CSV. Traz também as primeiras seções acadêmicas (alunos, turmas, responsáveis) para substituir
o Proesc aos poucos.

**Instalação única**: um deploy por cliente. A estrutura multi-tenant padrão (tabela `tenants`, RLS) continua,
com um cliente criado na instalação, e o **console do fornecedor** em `admin.<domínio>` bloqueia/libera o
cliente, controla o vencimento da licença e os módulos liberados.

---

## Sumário
1. [Tecnologias](#tecnologias)
2. [Lógica financeira (igual às planilhas e ao Power BI)](#lógica-financeira)
3. [Módulos e telas](#módulos-e-telas)
4. [Acessos e segurança](#acessos-e-segurança)
5. [Rodar no seu computador](#rodar-no-seu-computador)
6. [Banco e migrações](#banco-e-migrações)
7. [Publicar no Easypanel](#publicar-no-easypanel)
8. [Backups](#backups)
9. [Variáveis de ambiente](#variáveis-de-ambiente)
10. [Operação do dia a dia](#operação-do-dia-a-dia)

---

## Tecnologias

| Parte | Tecnologia |
|---|---|
| Aplicação | Next.js 15 (App Router + Server Actions), React 19, TypeScript |
| Banco | PostgreSQL 16, Drizzle ORM com migrações SQL versionadas (`drizzle/`) |
| Validação | Zod em todas as ações e rotas |
| Testes | Vitest (regras puras + testes de banco com PGlite: RLS, gatilhos e CHECKs) |
| E-mail | nodemailer (SMTP) para a recuperação de senha |
| Publicação | Docker multi-stage, usuário sem privilégios, `/api/health` com teste do banco |

## Lógica financeira

Mantém a lógica das planilhas por banco e dos painéis do cliente:

- **Empresas do grupo** (Bee School, Bee Light). Cada **conta** (Inter, C6, Cora, Itaú, Sicredi 1 e 2,
  Nordeste, Caixa dinheiro…) é de uma empresa — uma conta por planilha de "Fluxo de caixa".
- Cada movimento tem **Data, Descrição (= categoria), Entrada/Saída, Classificação (= descrição livre) e
  Nota (C/NF, S/NF)**, como as colunas das planilhas.
- Cada **categoria** soma num **grupo da DRE** (a mesma tabela de/para da planilha: Matrícula → Receita Bruta,
  Salários e ordenados → Despesas com Pessoal, Aplicação financeira → Investimento…).
- A **DRE gerencial** (regime de caixa) calcula: Receita Bruta → Receita Líquida (− impostos e taxas) →
  Margem Bruta (− variáveis e logística) → Resultado Operacional (− marketing, administrativas, diversas,
  pessoal, ocupação, TI) → Resultado Final Gerencial (− investimento).
- **% AH** = variação sobre o mês anterior; **%** = participação sobre o **faturamento de mensalidades**
  (grupos marcados como base; pode trocar para Receita Bruta em Administração › Instituição). Conferido com os
  números do painel (ex.: Pessoal 56,72%, Impostos 15,99% em setembro).
- **Indicadores** (Pessoal, Ocupação, Marketing, TI, Administração, Juros, Contabilidade, Consultorias,
  Pró-labore, Alimentação sócios) com **metas por empresa** ("Orçamento – Bee Light / Bee School"); o
  velocímetro fica vermelho quando passa da meta.
- Transferências entre contas e ajustes de saldo ficam no extrato e **não entram na DRE**.

Regras puras e testadas: `src/lib/dre.ts`, `src/lib/finance-rules.ts`. Regras críticas repetidas no banco
(migração `0001`): valor positivo, baixa com data/valor/conta, conta da mesma empresa do lançamento, uma
mensalidade por aluno e competência, lançamento baixado não se exclui.

## Módulos e telas

| Módulo | Telas |
|---|---|
| Início | saldo das contas, vencidos e a vencer, próximos 7 dias, atalhos |
| Financeiro | Contas a receber · Contas a pagar · Extrato (por conta, com saldo dia a dia, transferência e ajuste) · Fluxo de caixa previsto · Mensalidades (gera as do mês sem duplicar) · Importar planilha (.xlsx/.csv, prévia, duplicados, desfazer) · Relatórios (DRE + exportações CSV) · Configurações (empresas, contas, grupos da DRE, categorias, formas, situações, pessoas) |
| Painéis | Análise DRE · Fluxo de caixa · Indicadores · Orçamento e metas (filtros Ano, Mês, Banco, Empresa) |
| Acadêmico | Alunos (turma, responsável, mensalidade, desconto, dia de vencimento, código Proesc) · Turmas · Responsáveis |
| Administração | Usuários · Perfis de acesso · Instituição (logo, dados, base dos percentuais) |
| Console (`admin.`) | Clientes (licença paga até, tolerância, bloqueio com mensagem, módulos liberados, plano de usuários, histórico) · Administradores · Auditoria |

## Acessos e segurança

- **Áreas pelo Host**: `admin.<domínio>` (console), `<slug>.<domínio>` (escola), `<domínio>` (página inicial);
  qualquer outro domínio recebe 404. Subdomínios reservados não podem ser usados por clientes.
- **Níveis**: administrador do sistema (conta master protegida), administrador do cliente e usuário.
  **Perfis** por módulo com `NONE / VIEW / EDIT`. O catálogo de módulos e rotas fica em `src/lib/modules.ts`:
  o **middleware confere todo GET** de página e exportação; as páginas repetem; as **ações exigem EDIT**.
  Módulo não liberado pelo fornecedor fica sem acesso para todos.
- **Regras de usuários** em código (`src/lib/rules.ts`, testado) e em gatilho no banco: ninguém se rebaixa,
  desativa ou exclui; sempre sobra 1 administrador ativo; usuário não muda de cliente; master intocável.
- **Login**: bcrypt custo 12, hash fictício para usuário inexistente, mensagem genérica, limite por IP e por
  conta guardado no banco, bloqueio de 15 min após 5 erros, senha 10+ com maiúscula/minúscula/número,
  senha provisória com troca obrigatória.
- **2FA obrigatório no console** (TOTP, compatível com Google/Microsoft Authenticator); segredo cifrado com
  AES-256-GCM (`APP_SECRET`); código não pode ser reutilizado.
- **Sessão**: token aleatório de 256 bits, só o SHA-256 no banco, 12 h de duração e 120 min de inatividade,
  cookie `__Host-` HttpOnly/Secure/SameSite=Lax, presa à área e ao cliente; revogada ao trocar senha,
  desativar, mudar perfil ou bloquear. **Sessões ativas** em Minha conta (encerrar uma ou todas as outras).
- **Recuperação de senha por e-mail**: token de uso único (hash no banco), validade configurável, resposta
  igual exista ou não o e-mail; a conta master só recupera pelo console do servidor.
- **Bloqueio**: manual (com mensagem) ou **automático por vencimento** (`licença paga até` + tolerância).
  Vale na hora: toda requisição confere o cliente; os usuários veem a tela **Acesso suspenso**.
- **Banco**: RLS com `FORCE` em todas as tabelas de negócio, acesso pelo papel `erp_app` (sem bypass) dentro de
  `withTenant()` (`set_config` + `SET LOCAL ROLE`); FKs compostas `(tenant_id, id)`; unicidade por cliente.
- **Cabeçalhos**: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP.
- **Auditoria** (`audit_logs`): logins e falhas, lançamentos, baixas, estornos, importações, mensalidades,
  cadastros, perfis, bloqueios, exportações — com cliente, usuário, ação `entidade.verbo` e IP.
- **CSV** com proteção contra injeção de fórmula. Erros do banco traduzidos, sem detalhes internos.

## Rodar no seu computador

Pré-requisitos: Node.js 22 e PostgreSQL 16 (Docker: `docker compose up -d`) — ou o banco de
desenvolvimento sem Docker (PGlite).

```bash
npm install
```

```bash
cp .env.example .env
```

Edite o `.env` (no mínimo `DATABASE_URL`, `ROOT_DOMAIN=localhost:3000`, `COOKIE_SECURE=false`, `APP_SECRET`
e as variáveis `INITIAL_*`). Sem Docker, rode o banco de desenvolvimento num terminal e use
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres` e `DATABASE_POOL_MAX=1`:

```bash
npm run db:dev
```

Depois:

```bash
npm run db:migrate
```

```bash
npm run db:bootstrap
```

```bash
npm run dev
```

Abra `http://beeschool.localhost:3000` (escola) e `http://admin.localhost:3000` (console). Dados de
demonstração (só em teste): abra a escola uma vez e rode `DEMO=1 npm run db:seed-demo`.

Verificações:

```bash
npm run typecheck
```

```bash
npm test
```

## Banco e migrações

- `drizzle/0000_inicial.sql` (gerada) e `drizzle/0001_regras_e_isolamento.sql` (manual: CHECKs, gatilhos, RLS).
- As migrações rodam **no início do container**; se falharem, o container não sobe.
- **Nunca edite uma migração já aplicada.** Para mudar o banco: altere `src/db/*.ts`, rode
  `npm run db:generate`, revise o SQL; tabela nova de negócio entra em `TENANT_TABLES` e ganha uma migração
  `--custom` com `GRANT` + RLS (modelo: `0001`).
- Dinheiro em `numeric(14,2)`; datas de negócio em `date`.

## Publicar no Easypanel

1. **Postgres**: crie um serviço Postgres 16 no projeto e copie a *Internal Connection URL*.
2. **App**: crie um serviço *App* a partir do repositório GitHub, *Build: Dockerfile*.
3. **Variáveis**: `DATABASE_URL`, `ROOT_DOMAIN` (ex.: `beeschool.com.br`), `APP_SECRET` (gere uma vez e
   guarde), `INITIAL_*` da primeira subida e as de SMTP. Não defina `COOKIE_SECURE=false` em produção.
4. **Domínios** (porta 3000, HTTPS): `admin.beeschool.com.br`, `<slug>.beeschool.com.br` (ex.:
   `beeschool.beeschool.com.br` ou um slug curto como `escola`). No DNS, crie os registros A/CNAME.
5. **Deploy**. Nos logs: migrações aplicadas, conta master e cliente criados.
6. Entre em `admin.`: configure o **2FA**, confira o cliente (licença, módulos). Entre na escola com o
   administrador do cliente e troque a senha provisória.
7. **Apague as senhas `INITIAL_*`** das variáveis e faça novo deploy.
8. Health check: `/api/health` (200 com o banco ok, 503 sem banco).

## Backups

O banco é o único estado do sistema (inclusive a logo). Configure no Easypanel o **backup do serviço
Postgres** para um destino **externo** (S3/Backblaze/Wasabi), diário, guardando ao menos 30 dias, e teste
uma restauração por trimestre. Para uma cópia manual:

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > bee-school-$(date +%F).dump
```

O `APP_SECRET` precisa ficar guardado junto (sem ele, os 2FA do console precisam ser reconfigurados).

## Variáveis de ambiente

Ver `.env.example` (com explicação de cada uma). Obrigatórias: `DATABASE_URL`, `ROOT_DOMAIN`, `APP_SECRET`.

## Operação do dia a dia

- **Importar o histórico**: Financeiro › Importar planilha, uma planilha por conta. Categorias com nome
  diferente aparecem na prévia: cadastre-as ou importe sem categoria. Dá para desfazer cada importação.
- **Mensalidades**: Financeiro › Mensalidades, escolha a competência e gere (repetir não duplica).
- **Bloquear/liberar o cliente**: console › Clientes › cliente. O bloqueio automático acontece depois de
  "licença paga até" + tolerância.
- **Conta master sem acesso** (senha ou celular do 2FA perdido), no console do servidor:
  `NEW_PASSWORD='NovaSenhaForte2026' RESET_2FA=1 node scripts/reset-master-password.mjs`.
