import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";
import { adminSession, findTenant, requestArea, tenantSession } from "@/lib/context";
import { tenantBlocked } from "@/lib/session-core";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function Login() {
  const info = await requestArea();
  if (info.area === "admin") {
    if (await adminSession()) redirect("/");
    return <LoginScreen admin tag="Console do fornecedor" title="Entrar no console" subtitle="Acesso restrito aos administradores do sistema. Exige o código do aplicativo autenticador." />;
  }
  if (info.area === "tenant") {
    const t = await findTenant(info.slug);
    if (!t) notFound();
    if (tenantBlocked(t)) redirect("/suspenso");
    if (await tenantSession()) redirect("/");
    return <LoginScreen tag={t.name} title="Entrar" subtitle="Use o seu e-mail e a sua senha de acesso." />;
  }
  redirect("/");
}
