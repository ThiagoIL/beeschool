import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";
import { appSession, getSystem } from "@/lib/context";
import { systemBlocked } from "@/lib/session-core";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function Login() {
  const sys = await getSystem();
  if (systemBlocked(sys)) redirect("/suspenso");
  if (await appSession()) redirect("/");
  return <LoginScreen tag={sys.name} title="Entrar" subtitle="Use o seu e-mail e a sua senha de acesso." />;
}
