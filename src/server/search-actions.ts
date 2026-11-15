"use server";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import * as E from "@/db/erp";
import { act, NO_ACCESS } from "@/lib/access";

/** Pesquisas das janelas de seleção (cadastros que podem crescer muito são escolhidos por pesquisa). */
const PAGE = 30;
const input = z.object({ q: z.string().max(120).default(""), filter: z.string().max(60).default(""), page: z.number().int().min(1).max(10000).default(1) });
type In = z.input<typeof input>;
export type SearchRow = { id: string; label: string; cells: string[]; data?: Record<string, string> };
export type SearchResult = { rows: SearchRow[]; total: number } | { error: string };

const like = (q: string) => `%${q.trim()}%`;

/** Pessoas (responsáveis, fornecedores, funcionários, prestadores). filter = tipo. */
export async function searchPeopleAction(raw: In): Promise<SearchResult> {
  const s = await act(["financeiro", "academico"]);
  if (!s) return { error: NO_ACCESS.error };
  const d = input.parse(raw);
  return s.tx(async (tx) => {
    const c: SQL[] = [eq(E.people.active, true)];
    if (d.q.trim()) {
      const digits = d.q.replace(/\D/g, "");
      c.push(or(ilike(E.people.name, like(d.q)), ilike(E.people.email, like(d.q)), ilike(E.people.phone, like(d.q)),
        ...(digits.length >= 3 ? [sql`regexp_replace(coalesce(${E.people.document}, ''), '\\D', '', 'g') like ${"%" + digits + "%"}`] : []))!);
    }
    if (d.filter) c.push(sql`${d.filter} = any(${E.people.kinds})`);
    const where = and(...c);
    const rows = await tx.select().from(E.people).where(where).orderBy(asc(E.people.name)).limit(PAGE).offset((d.page - 1) * PAGE);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(E.people).where(where);
    return { total, rows: rows.map((p) => ({ id: p.id, label: p.name, cells: [p.name, p.kinds.join(", ") || "—", p.document ?? "—", p.phone ?? "—"] })) };
  });
}

/** Alunos (para lançar contas a receber de um aluno). */
export async function searchStudentsAction(raw: In): Promise<SearchResult> {
  const s = await act(["financeiro", "academico"]);
  if (!s) return { error: NO_ACCESS.error };
  const d = input.parse(raw);
  return s.tx(async (tx) => {
    const c: SQL[] = [];
    if (d.q.trim()) c.push(or(ilike(E.students.name, like(d.q)), ilike(E.students.externalCode, like(d.q)))!);
    if (d.filter) c.push(eq(E.students.status, d.filter));
    const where = c.length ? and(...c) : undefined;
    const rows = await tx.select({ s: E.students, t: E.classes.name, g: E.people.name }).from(E.students)
      .leftJoin(E.classes, eq(E.classes.id, E.students.classId)).leftJoin(E.people, eq(E.people.id, E.students.guardianId))
      .where(where).orderBy(asc(E.students.name)).limit(PAGE).offset((d.page - 1) * PAGE);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(E.students).where(where);
    return { total, rows: rows.map(({ s: st, t, g }) => ({ id: st.id, label: st.name, cells: [st.name, t ?? "—", g ?? "—", st.status], data: { companyId: st.companyId, guardianId: st.guardianId ?? "" } })) };
  });
}
