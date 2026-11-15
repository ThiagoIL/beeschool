import { asc, ne, sql } from "drizzle-orm";
import { requireUser } from "@/lib/context";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import * as E from "@/db/erp";
import { PageHead } from "@/components/ui";
import { ProfilesTable } from "@/components/AdminUI";
import { Field, Form, Submit } from "@/components/Form";
import { LogoUpload } from "@/components/LogoUpload";
import { saveCompanyAction } from "@/server/school-admin-actions";
import { UFS } from "@/components/ui";

export async function ProfilesPage() {
  const s = await requireUser({ admin: true });
  const rows = await db.transaction((tx) => tx.select().from(E.accessProfiles).orderBy(asc(E.accessProfiles.name)));
  const counts = await db.select({ p: users.profileId, n: sql<number>`count(*)::int` }).from(users).where(ne(users.role, "SUPER_ADMIN")).groupBy(users.profileId);
  return (
    <>
      <PageHead title="Perfis de acesso" sub="O que cada perfil pode consultar e alterar em cada módulo. Ligue o perfil ao usuário na tela do usuário." />
      <ProfilesTable rows={rows.map((p) => ({ id: p.id, name: p.name, description: p.description ?? "", permissions: p.permissions, users: counts.find((c) => c.p === p.id)?.n ?? 0 }))} />
    </>
  );
}

export async function CompanyPage() {
  const s = await requireUser({ admin: true });
  const [c] = await db.transaction((tx) => tx.select().from(E.companySettings).limit(1));
  return (
    <>
      <PageHead title="Instituição" sub="Dados gerais e preferências dos painéis. As empresas do grupo (Bee School, Bee Light) ficam em Financeiro › Configurações › Empresas." />
      <section className="panel sec-panel" style={{ marginBottom: 16 }}><h2>Logo</h2><div className="pb">
        <LogoUpload src={c?.logo ? `/api/logo?v=${c.logoAt?.getTime() ?? 0}` : null} />
      </div></section>
      <Form action={saveCompanyAction} className="sheet">
        <section className="panel sec-panel"><h2>Dados</h2><div className="pb"><div className="form f4">
          <Field name="razao" label="Razão social" defaultValue={c?.legalName ?? s.system.name} full />
          <Field name="fantasia" label="Nome fantasia" defaultValue={c?.tradeName} />
          <Field name="cnpj" label="CNPJ" defaultValue={c?.document} />
          <Field name="telefone" label="Telefone" defaultValue={c?.phone} />
          <Field name="email" label="E-mail" defaultValue={c?.email} />
          <Field name="cidade" label="Cidade" defaultValue={c?.city} />
          <Field name="uf" label="UF" options={UFS.map((u) => [u, u] as const)} emptyOption="—" defaultValue={c?.uf} />
        </div></div></section>
        <section className="panel sec-panel"><h2>Painéis</h2><div className="pb"><div className="form">
          <Field name="base" label="Percentuais calculados sobre" full options={[["MENSALIDADE", "Faturamento de mensalidades (grupos marcados como base na DRE)"], ["RECEITA_BRUTA", "Receita Bruta (todas as receitas)"]]} defaultValue={c?.pctBase ?? "MENSALIDADE"} />
        </div></div></section>
        <div className="sticky-foot"><Submit>Salvar</Submit></div>
      </Form>
    </>
  );
}
