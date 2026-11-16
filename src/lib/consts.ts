/** Rótulos e listas fixas em português, centralizados (servidor e navegador). */

export const DRE_SECTIONS = [
  ["RECEITA", "Receita bruta"],
  ["DEDUCAO", "Deduções (impostos e taxas) — antes da Receita Líquida"],
  ["VARIAVEL", "Custos variáveis — antes da Margem Bruta"],
  ["OPERACIONAL", "Despesas operacionais — antes do Resultado Operacional"],
  ["INVESTIMENTO", "Investimentos — antes do Resultado Final Gerencial"],
] as const;
export type DreSection = (typeof DRE_SECTIONS)[number][0];

/** Tipo da categoria: receita aparece nas contas a receber, despesa nas contas a pagar. */
export const CATEGORY_KINDS: [string, string][] = [["RECEBER", "Receita"], ["PAGAR", "Despesa"]];

export const ACCOUNT_KINDS: [string, string][] = [["BANCO", "Conta bancária"], ["CAIXA", "Caixa (dinheiro)"], ["APLICACAO", "Aplicação financeira"]];
export const PERSON_KINDS = ["Responsável financeiro", "Fornecedor", "Funcionário", "Prestador de serviço"] as const;

export const STUDENT_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "" }> = {
  ATIVO: { label: "Ativo", tone: "ok" },
  TRANCADO: { label: "Trancado", tone: "warn" },
  CANCELADO: { label: "Cancelado", tone: "bad" },
  CONCLUIDO: { label: "Concluído", tone: "" },
};
export const LEVELS_SCHOOL = ["Educação Infantil", "Ensino Fundamental I", "Ensino Fundamental II", "Ensino Médio", "Contraturno", "Esportes"];
export const SHIFTS = ["Manhã", "Tarde", "Integral", "Noite"];

export const TITLE_STATUS: Record<string, string> = { ABERTO: "Em aberto", PAGO: "Baixado", CANCELADO: "Cancelado" };
export const ORIGIN_LABEL: Record<string, string> = { MANUAL: "Lançamento manual", MENSALIDADE: "Mensalidade", IMPORTACAO: "Importação de planilha" };
export const INVOICE_LABEL: Record<string, string> = { COM: "C/NF", SEM: "S/NF" };

export const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
