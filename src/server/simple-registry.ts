import "server-only";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db";
import * as E from "@/db/erp";
import type { ModuleKey } from "@/lib/modules";
import { ACCOUNT_KINDS, DRE_SECTIONS, LEVELS_SCHOOL, PERSON_KINDS, SHIFTS, STUDENT_STATUS } from "@/lib/consts";

/** Tipos de campo dos cadastros simples. */
export type SFieldType = "text" | "textarea" | "date" | "num" | "int" | "money" | "select" | "multi" | "check" | "color" | "list" | "partner";
export type Opt = [string, string];
export type SField = {
  k: string; label: string; t?: SFieldType; req?: boolean; full?: boolean; hint?: string; upper?: boolean; max?: number;
  opts?: Opt[] | ((tx: Tx) => Promise<Opt[]>); def?: string | number | boolean | number[] | string[];
  /** filtro fixo da janela de pesquisa de pessoas (tipo) */
  pickFilter?: string;
};
export type SColFmt = "num" | "money" | "active" | "color" | "code" | "desc" | "opt" | "list";
export type SCol = { k: string; label: string; f?: SColFmt };
export type SEntity = {
  mod: ModuleKey; table: PgTable & { id: PgColumn }; title: string; sub: string; one: string; fem?: boolean;
  fields: SField[]; cols: SCol[]; order: (t: never) => SQL | PgColumn | (SQL | PgColumn)[];
  counts?: { k: string; label: string; sql: SQL; f?: SColFmt }[];
  /** registros que impedem a exclusão (com histórico, desative em vez de excluir): [tabela, coluna, mensagem] */
  uses?: [PgTable, PgColumn, string][];
  autoPos?: boolean;
  where?: SQL;
  check?: (tx: Tx, values: Record<string, unknown>, id: string) => Promise<string | null>;
  guard?: (tx: Tx, id: string) => Promise<string | null>;
};

const t = <T extends PgTable & { id: PgColumn }>(x: T) => x as T;
const companiesOpt = async (tx: Tx): Promise<Opt[]> => (await tx.select({ id: E.companies.id, n: E.companies.name }).from(E.companies).orderBy(asc(E.companies.name))).map((r) => [r.id, r.n]);
const groupsOpt = async (tx: Tx): Promise<Opt[]> => (await tx.select({ id: E.dreGroups.id, n: E.dreGroups.name }).from(E.dreGroups).orderBy(asc(E.dreGroups.position))).map((r) => [r.id, r.n]);
const classesOpt = async (tx: Tx): Promise<Opt[]> => (await tx.select({ id: E.classes.id, n: E.classes.name, y: E.classes.year }).from(E.classes).orderBy(sql`${E.classes.year} desc`, asc(E.classes.name))).map((r) => [r.id, `${r.n} (${r.y})`]);
const guardiansOpt = async (tx: Tx): Promise<Opt[]> => (await tx.select({ id: E.people.id, n: E.people.name }).from(E.people).orderBy(asc(E.people.name)).limit(5000)).map((r) => [r.id, r.n]);
const list = (xs: readonly string[]): Opt[] => xs.map((x) => [x, x]);

export const SIMPLE: Record<string, SEntity> = {
  empresas: {
    mod: "financeiro", table: t(E.companies), title: "Empresas do grupo", sub: "Cada conta, aluno e lançamento é de uma empresa. Os painéis filtram por empresa ou mostram o grupo consolidado.", one: "empresa", fem: true,
    fields: [{ k: "name", label: "Nome", req: true }, { k: "document", label: "CNPJ" }, { k: "color", label: "Cor nos painéis", t: "color", full: true, def: "#E9AE20" }, { k: "active", label: "Empresa ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Empresa", f: "color" }, { k: "document", label: "CNPJ" }, { k: "active", label: "Situação", f: "active" }],
    counts: [{ k: "c", label: "Contas", sql: sql`(select count(*)::int from bank_accounts b where b.company_id = companies.id)`, f: "num" },
      { k: "a", label: "Alunos ativos", sql: sql`(select count(*)::int from students s where s.company_id = companies.id and s.status = 'ATIVO')`, f: "num" }],
    uses: [[E.bankAccounts, E.bankAccounts.companyId, "A empresa tem contas cadastradas. Marque como inativa em vez de excluir."], [E.finTitles, E.finTitles.companyId, "A empresa tem lançamentos. Marque como inativa em vez de excluir."], [E.students, E.students.companyId, "A empresa tem alunos. Marque como inativa em vez de excluir."]],
    order: () => asc(E.companies.name),
  },
  contas: {
    mod: "financeiro", table: t(E.bankAccounts), title: "Contas e caixas", sub: "Uma conta por banco e empresa (como as planilhas de fluxo de caixa), mais o caixa em dinheiro e as aplicações. O saldo inicial é o valor na data de início do controle.", one: "conta", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, hint: "Ex.: Sicredi 1, Caixa dinheiro" }, { k: "companyId", label: "Empresa", t: "select", req: true, opts: companiesOpt },
      { k: "kind", label: "Tipo", t: "select", req: true, opts: ACCOUNT_KINDS, def: "BANCO" }, { k: "bank", label: "Banco" }, { k: "agency", label: "Agência" }, { k: "account", label: "Conta" },
      { k: "initialBalance", label: "Saldo inicial (R$)", t: "money", def: 0, hint: "Pode ser negativo." }, { k: "initialDate", label: "Data do saldo inicial", t: "date" }, { k: "active", label: "Conta ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Conta", f: "desc" }, { k: "companyId", label: "Empresa", f: "opt" }, { k: "kind", label: "Tipo", f: "opt" }, { k: "initialBalance", label: "Saldo inicial", f: "money" }, { k: "active", label: "Situação", f: "active" }],
    uses: [[E.finTitles, E.finTitles.bankAccountId, "Há lançamentos baixados nesta conta. Marque como inativa em vez de excluir."], [E.bankEntries, E.bankEntries.bankAccountId, "Há movimentos no extrato desta conta. Marque como inativa em vez de excluir."], [E.finImports, E.finImports.bankAccountId, "Há importações nesta conta. Marque como inativa em vez de excluir."]],
    check: async (tx, v, id) => {
      if (!id) return null;
      const [cur] = await tx.select({ c: E.bankAccounts.companyId }).from(E.bankAccounts).where(eq(E.bankAccounts.id, id)).limit(1);
      if (cur && cur.c !== v.companyId) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(E.finTitles).where(eq(E.finTitles.bankAccountId, id));
        if (n > 0) return "A conta já tem lançamentos: não dá para trocar a empresa dela.";
      }
      return null;
    },
    order: () => [asc(E.bankAccounts.companyId), asc(E.bankAccounts.name)],
  },
  grupos: {
    mod: "financeiro", table: t(E.dreGroups), title: "Grupos da DRE", sub: "Os grupos somam as categorias. A seção define onde o grupo entra no cálculo (Receita Líquida, Margem Bruta, Resultado Operacional e Resultado Final Gerencial).", one: "grupo", autoPos: true,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "section", label: "Seção da DRE", t: "select", req: true, full: true, opts: DRE_SECTIONS.map(([a, b]) => [a, b] as Opt), def: "OPERACIONAL" },
      { k: "position", label: "Ordem na DRE", t: "int", req: true }, { k: "isBase", label: "É faturamento (base dos percentuais)", t: "check", def: false }, { k: "active", label: "Grupo ativo", t: "check", def: true }],
    cols: [{ k: "position", label: "Ordem", f: "num" }, { k: "name", label: "Grupo", f: "desc" }, { k: "section", label: "Seção", f: "opt" }, { k: "isBase", label: "Base %", f: "active" }],
    counts: [{ k: "n", label: "Categorias", sql: sql`(select count(*)::int from fin_categories c where c.group_id = dre_groups.id)`, f: "num" }],
    uses: [[E.finCategories, E.finCategories.groupId, "O grupo tem categorias. Mova-as para outro grupo antes de excluir."], [E.indicators, E.indicators.groupId, "Há indicadores usando este grupo."]],
    order: () => asc(E.dreGroups.position),
  },
  categorias: {
    mod: "financeiro", table: t(E.finCategories), title: "Categorias", sub: "Classificação de cada lançamento (coluna “Descrição” das planilhas). Cada categoria soma em um grupo da DRE.", one: "categoria", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "groupId", label: "Grupo da DRE", t: "select", req: true, full: true, opts: groupsOpt }, { k: "active", label: "Categoria ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Categoria", f: "desc" }, { k: "groupId", label: "Grupo da DRE", f: "opt" }, { k: "active", label: "Situação", f: "active" }],
    counts: [{ k: "n", label: "Lançamentos", sql: sql`(select count(*)::int from fin_titles x where x.category_id = fin_categories.id)`, f: "num" }],
    uses: [[E.finTitles, E.finTitles.categoryId, "Há lançamentos nesta categoria. Marque como inativa em vez de excluir."]],
    order: () => [asc(sql`(select g.position from dre_groups g where g.id = fin_categories.group_id)`), asc(E.finCategories.name)],
  },
  formas: {
    mod: "financeiro", table: t(E.paymentMethods), title: "Formas de pagamento", sub: "PIX, boleto, cartão, dinheiro…", one: "forma", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "active", label: "Forma ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Forma", f: "desc" }, { k: "active", label: "Situação", f: "active" }],
    uses: [[E.finTitles, E.finTitles.paymentMethodId, "Há lançamentos com esta forma. Marque como inativa em vez de excluir."]],
    order: () => asc(E.paymentMethods.name),
  },
  situacoes: {
    mod: "financeiro", table: t(E.finSituations), title: "Situações", sub: "Marcações internas dos lançamentos em aberto (ex.: Aguardando aprovação, Agendado).", one: "situação", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "color", label: "Cor", t: "color", full: true, def: "#B7791F" }, { k: "active", label: "Situação ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Situação", f: "color" }, { k: "active", label: "Ativa", f: "active" }],
    uses: [[E.finTitles, E.finTitles.situationId, "Há lançamentos com esta situação. Marque como inativa em vez de excluir."]],
    order: () => asc(E.finSituations.name),
  },
  pessoas: {
    mod: "financeiro", table: t(E.people), title: "Pessoas e fornecedores", sub: "Responsáveis financeiros, fornecedores, funcionários e prestadores ligados aos lançamentos.", one: "pessoa", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "kinds", label: "Tipo", t: "multi", full: true, opts: list(PERSON_KINDS) },
      { k: "document", label: "CPF ou CNPJ" }, { k: "phone", label: "Telefone" }, { k: "email", label: "E-mail", full: true }, { k: "notes", label: "Observações", t: "textarea", full: true }, { k: "active", label: "Cadastro ativo", t: "check", def: true }],
    cols: [{ k: "name", label: "Nome", f: "desc" }, { k: "kinds", label: "Tipo", f: "list" }, { k: "document", label: "CPF/CNPJ" }, { k: "phone", label: "Telefone" }, { k: "active", label: "Situação", f: "active" }],
    uses: [[E.finTitles, E.finTitles.personId, "Há lançamentos desta pessoa. Marque como inativa em vez de excluir."], [E.students, E.students.guardianId, "Esta pessoa é responsável por alunos. Marque como inativa em vez de excluir."]],
    order: () => asc(E.people.name),
  },
  responsaveis: {
    mod: "academico", table: t(E.people), title: "Responsáveis", sub: "Responsáveis financeiros dos alunos (mesmo cadastro de Pessoas do financeiro).", one: "responsável",
    where: sql`'Responsável financeiro' = any(${E.people.kinds})`,
    fields: [{ k: "name", label: "Nome", req: true, full: true }, { k: "kinds", label: "Tipo", t: "multi", full: true, opts: list(PERSON_KINDS), def: ["Responsável financeiro"] },
      { k: "document", label: "CPF" }, { k: "phone", label: "Telefone" }, { k: "email", label: "E-mail", full: true }, { k: "notes", label: "Observações", t: "textarea", full: true }, { k: "active", label: "Cadastro ativo", t: "check", def: true }],
    cols: [{ k: "name", label: "Nome", f: "desc" }, { k: "document", label: "CPF" }, { k: "phone", label: "Telefone" }, { k: "email", label: "E-mail" }, { k: "active", label: "Situação", f: "active" }],
    counts: [{ k: "n", label: "Alunos", sql: sql`(select count(*)::int from students s where s.guardian_id = people.id)`, f: "num" }],
    uses: [[E.students, E.students.guardianId, "Esta pessoa é responsável por alunos. Marque como inativa em vez de excluir."], [E.finTitles, E.finTitles.personId, "Há lançamentos desta pessoa. Marque como inativa em vez de excluir."]],
    order: () => asc(E.people.name),
  },
  turmas: {
    mod: "academico", table: t(E.classes), title: "Turmas", sub: "Turmas por ano letivo e empresa.", one: "turma", fem: true,
    fields: [{ k: "name", label: "Nome", req: true, hint: "Ex.: Infantil 3 A" }, { k: "year", label: "Ano letivo", t: "int", req: true, def: new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0) },
      { k: "companyId", label: "Empresa", t: "select", req: true, opts: companiesOpt }, { k: "level", label: "Segmento", t: "select", opts: list(LEVELS_SCHOOL) },
      { k: "shift", label: "Turno", t: "select", opts: list(SHIFTS) }, { k: "capacity", label: "Vagas", t: "int" }, { k: "active", label: "Turma ativa", t: "check", def: true }],
    cols: [{ k: "name", label: "Turma", f: "desc" }, { k: "year", label: "Ano", f: "code" }, { k: "companyId", label: "Empresa", f: "opt" }, { k: "level", label: "Segmento" }, { k: "shift", label: "Turno" }, { k: "capacity", label: "Vagas", f: "num" }],
    counts: [{ k: "n", label: "Alunos ativos", sql: sql`(select count(*)::int from students s where s.class_id = classes.id and s.status = 'ATIVO')`, f: "num" }],
    uses: [[E.students, E.students.classId, "A turma tem alunos. Marque como inativa em vez de excluir."]],
    order: () => [sql`${E.classes.year} desc`, asc(E.classes.name)],
  },
  alunos: {
    mod: "academico", table: t(E.students), title: "Alunos", sub: "Cadastro dos alunos com turma, responsável e mensalidade. As mensalidades do mês são geradas em Financeiro › Mensalidades.", one: "aluno",
    fields: [{ k: "name", label: "Nome do aluno", req: true, full: true }, { k: "companyId", label: "Empresa", t: "select", req: true, opts: companiesOpt },
      { k: "classId", label: "Turma", t: "select", opts: classesOpt }, { k: "guardianId", label: "Responsável financeiro", t: "partner", full: true, opts: guardiansOpt, pickFilter: "Responsável financeiro" },
      { k: "status", label: "Situação", t: "select", req: true, def: "ATIVO", opts: Object.entries(STUDENT_STATUS).map(([k, v]) => [k, v.label] as Opt) },
      { k: "birthDate", label: "Nascimento", t: "date" }, { k: "monthlyFee", label: "Mensalidade cheia (R$)", t: "money", def: 0 }, { k: "discount", label: "Desconto (R$)", t: "money", def: 0, hint: "Bolsa, desconto de irmão…" },
      { k: "dueDay", label: "Dia do vencimento", t: "int", def: 10, hint: "De 1 a 28." }, { k: "externalCode", label: "Código no Proesc" }, { k: "notes", label: "Observações", t: "textarea", full: true }],
    cols: [{ k: "name", label: "Aluno", f: "desc" }, { k: "classId", label: "Turma", f: "opt" }, { k: "guardianId", label: "Responsável", f: "opt" }, { k: "monthlyFee", label: "Mensalidade", f: "money" }, { k: "discount", label: "Desconto", f: "money" }, { k: "status", label: "Situação", f: "opt" }],
    uses: [[E.finTitles, E.finTitles.studentId, "O aluno tem lançamentos financeiros. Mude a situação para Cancelado ou Concluído em vez de excluir."]],
    check: async (tx, v) => {
      if (Number(v.discount) > Number(v.monthlyFee)) return "O desconto não pode ser maior que a mensalidade.";
      const d = Number(v.dueDay);
      if (!Number.isInteger(d) || d < 1 || d > 28) return "O dia do vencimento vai de 1 a 28.";
      if (v.classId) {
        const [c] = await tx.select({ c: E.classes.companyId }).from(E.classes).where(eq(E.classes.id, String(v.classId))).limit(1);
        if (c && c.c !== v.companyId) return "A turma escolhida é de outra empresa.";
      }
      return null;
    },
    order: () => asc(E.students.name),
  },
};

export const isSimpleKey = (k: string): k is keyof typeof SIMPLE => Object.prototype.hasOwnProperty.call(SIMPLE, k);
export { and, eq, ne };
