import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";
import { consoleSession } from "@/lib/context";
import { consoleHref } from "@/lib/console-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Console", robots: { index: false, follow: false } };

/** Login do console do fornecedor: contas e cookie separados dos da escola. */
export default async function ConsoleLogin() {
  if (await consoleSession()) redirect(consoleHref("/"));
  return <LoginScreen admin tag="Console do fornecedor" title="Entrar no console" subtitle="Acesso restrito aos administradores do sistema. Use a conta do console (diferente da conta da escola)." />;
}
