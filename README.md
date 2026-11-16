# Bee School

Sistema de gestão escolar da **Bee Christian School** e da **Be Light Christian School**, começando pelo
**financeiro**: contas a receber e a pagar, extrato por banco, fluxo de caixa, mensalidades, importação das
planilhas, DRE gerencial, painéis (Análise DRE, Fluxo de caixa, Indicadores com metas do orçamento) e
exportações em CSV. Traz também as primeiras seções acadêmicas (alunos, turmas, responsáveis) para substituir
o Proesc aos poucos.

**Sistema de uma escola só** (sem multi-tenant): um deploy, um banco, uma instituição. O **console do
fornecedor** fica no mesmo domínio, em `/sistema-admin` (configurável), com login e contas separados dos da
escola: bloqueia/libera o sistema, controla o vencimento da licença, os módulos liberados e o plano de usuários.

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
| Testes | Vitest (regras puras + testes de banco com PGlite: gatilhos, CHECKs e chaves) |
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
| Financeiro | Contas a receber · Contas a pagar · Extrato (por conta, com saldo dia a dia, transferência e ajuste) · Fluxo de caixa previsto · Mensalidades (gera as do mês sem duplicar) · Configurações (empresas, contas, grupos da DRE, categorias receita/despesa, formas, situações, pessoas, importar planilha .xlsx/.csv com prévia, duplicados e desfazer) |
| Painéis | Análise DRE · Fluxo de caixa · Indicadores · Orçamento e metas (filtros Ano, Mês, Banco, Empresa) |
| Acadêmico | Alunos (turma, responsável, mensalidade, desconto, dia de vencimento, código Proesc) · Turmas · Responsáveis |
| Administração | Usuários · Perfis de acesso · Instituição (logo, dados, base dos percentuais) |
| Console (`/sistema-admin`) | Licença e módulos (licença paga até, tolerância, bloqueio com mensagem, módulos liberados, plano de usuários, usuários da escola, histórico) · Administradores do console · Auditoria · Minha conta |

## Acessos e segurança

- **Duas áreas no mesmo domínio**: a escola na raiz e o console em `PLATFORM_ADMIN_PATH` (padrão
  `/sistema-admin`). O middleware reescreve o caminho do console para as telas internas `/console/*` (que dão
  404 se acessadas direto) e informa a área às páginas; o navegador não consegue escolher a área.
- **Contas separadas**: administradores do console (`SUPER_ADMIN`, conta master protegida) só entram pelo login
  do console; administradores e usuários da escola só pelo login da escola. O mesmo e-mail pode existir nas
  duas áreas. Cookies separados: `__Host-bee_sess` (escola) e `__Secure-bee_console`, enviado só ao caminho
  do console. Uma sessão nunca vale na outra área.
- **Níveis da escola**: administrador e usuário.
  **Perfis** por módulo com `NONE / VIEW / EDIT`. O catálogo de módulos e rotas fica em `src/lib/modules.ts`:
  o **middleware confere todo GET** de página e exportação; as páginas repetem; as **ações exigem EDIT**.
  Módulo não liberado pelo fornecedor fica sem acesso para todos.
- **Regras de usuários** em código (`src/lib/rules.ts`, testado) e em gatilho no banco: ninguém se rebaixa,
  desativa ou exclui; sempre sobra 1 administrador ativo no console e na escola; conta do console não vira
  conta da escola (nem o contrário); master intocável.
- **Login**: bcrypt custo 12, hash fictício para usuário inexistente, mensagem genérica, limite por IP e por
  conta guardado no banco, bloqueio de 15 min após 5 erros, senha 10+ com maiúscula/minúscula/número,
  senha provisória com troca obrigatória.
- **Sem 2FA por enquanto** (decisão de nov/2026; pode voltar no futuro).
- **Sessão**: token aleatório de 256 bits; no banco fica só o HMAC-SHA256 dele com o `AUTH_SECRET`
  (trocar o `AUTH_SECRET` desconecta todo mundo e invalida os links de senha pendentes), 12 h de duração e 120 min de inatividade,
  cookie HttpOnly/Secure/SameSite=Lax, presa à área; revogada ao trocar senha,
  desativar, mudar perfil ou bloquear. **Sessões ativas** em Minha conta (encerrar uma ou todas as outras).
- **Recuperação de senha por e-mail**: token de uso único (hash no banco), validade configurável, resposta
  igual exista ou não o e-mail. Só para a escola: no console, outro administrador redefine a senha, e a
  conta master recupera pelo terminal do servidor.
- **Bloqueio**: manual (com mensagem) ou **automático por vencimento** (`licença paga até` + tolerância).
  Vale na hora: toda requisição confere a configuração; os usuários da escola veem a tela **Acesso suspenso**
  e o console continua acessível para liberar.
- **Banco**: chaves estrangeiras em todos os vínculos, CHECKs e gatilhos para as regras críticas, configuração
  do fornecedor numa linha única (`system_settings`).
- **Cabeçalhos**: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP.
- **Auditoria** (`audit_logs`): logins e falhas, lançamentos, baixas, estornos, importações, mensalidades,
  cadastros, perfis, bloqueios, exportações — com área (escola ou console), usuário, ação `entidade.verbo` e IP.
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

Edite o `.env` (no mínimo `DATABASE_URL`, `AUTH_SECRET`, `COOKIE_SECURE=false` e as variáveis
`PLATFORM_ADMIN_*` e `ADMIN_*`). Sem Docker, rode o banco de desenvolvimento num terminal e use
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

Abra `http://localhost:3000` (escola) e `http://localhost:3000/sistema-admin` (console). Dados de
demonstração (só em teste): abra a escola uma vez e rode `DEMO=1 npm run db:seed-demo`.

Verificações:

```bash
npm run typecheck
```

```bash
npm test
```

## Banco e migrações

- `drizzle/0000_inicial.sql` (gerada) e `drizzle/0001_regras.sql` (manual: CHECKs, gatilhos, linha única da configuração).
- As migrações rodam **no início do container**; se falharem, o container não sobe.
- **Nunca edite uma migração já aplicada.** Para mudar o banco: altere `src/db/*.ts`, rode
  `npm run db:generate` e revise o SQL; regras extras (CHECKs, gatilhos) vão numa migração `--custom`
  (modelo: `0001`).
- Dinheiro em `numeric(14,2)`; datas de negócio em `date`.

## Publicar no Easypanel

1. **Postgres**: crie um serviço Postgres 16 no projeto e copie a *Internal Connection URL*.
2. **App**: crie um serviço *App* a partir do repositório GitHub, *Build: Dockerfile*.
3. **Variáveis**: `DATABASE_URL`, `AUTH_SECRET` (gere uma vez e guarde), `PLATFORM_ADMIN_*` e `ADMIN_*` da
   primeira subida, as de SMTP (opcional) e, se quiser, `PLATFORM_ADMIN_PATH` e `APP_URL`. Não defina
   `COOKIE_SECURE=false` em produção.
4. **Domínio** (porta 3000, HTTPS): um só, ex.: `sistema.beeschool.com.br`. No DNS, crie o registro A/CNAME.
5. **Deploy**. Nos logs: migrações aplicadas, conta master do console e administrador da escola criados.
6. Entre em `https://seu-dominio/sistema-admin` e confira licença e módulos. Entre na escola (`https://seu-dominio`) com o administrador e troque a senha provisória.
7. **Apague as senhas** (`PLATFORM_ADMIN_PASSWORD`, `ADMIN_PASSWORD`) das variáveis e faça novo deploy.
8. Health check: `/api/health` (200 com o banco ok, 503 sem banco).

## Backups

O banco é o único estado do sistema (inclusive a logo). Configure no Easypanel o **backup do serviço
Postgres** para um destino **externo** (S3/Backblaze/Wasabi), diário, guardando ao menos 30 dias, e teste
uma restauração por trimestre. Para uma cópia manual:

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > bee-school-$(date +%F).dump
```

Os backups não dependem do `AUTH_SECRET`: com outra chave, os dados voltam inteiros e só é preciso entrar de novo.

## Variáveis de ambiente

Ver `.env.example` (com explicação de cada uma). Obrigatórias: `DATABASE_URL` e `AUTH_SECRET`.

## Operação do dia a dia

- **Importar o histórico**: Financeiro › Configurações › Importar planilha, uma planilha por conta. Categorias com nome
  diferente aparecem na prévia: cadastre-as ou importe sem categoria. Dá para desfazer cada importação.
- **Mensalidades**: Financeiro › Mensalidades, escolha a competência e gere (repetir não duplica).
- **Bloquear/liberar o sistema**: console › Licença e módulos. O bloqueio automático acontece depois de
  "licença paga até" + tolerância.
- **Conta master sem acesso** (senha perdida), no console do servidor:
  `NEW_PASSWORD='NovaSenhaForte2026' node scripts/reset-master-password.mjs`.
- **Desconectar todo mundo de uma vez** (ex.: suspeita de vazamento): troque o `AUTH_SECRET` e reinicie o app.
