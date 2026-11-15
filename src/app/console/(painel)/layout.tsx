import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { consoleSession, needsTwoFactorSetup } from "@/lib/context";
import { consoleNav } from "@/lib/modules";
import { consoleBase, consoleHref } from "@/lib/console-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Moldura do console do fornecedor (caminho PLATFORM_ADMIN_PATH). */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await consoleSession();
  if (!s) redirect(consoleHref("/login"));
  // com troca de senha (ou 2FA obrigatório) pendente, o console mostra só "Minha conta" (sem menu)
  const nav = !needsTwoFactorSetup(s.user) && !s.user.mustChangePassword ? consoleNav(consoleBase()) : [];
  return <Shell nav={nav} base={consoleBase()} context="Console do fornecedor" user={s.user} roleLabel={s.user.isMaster ? "Administrador do console · master" : "Administrador do console"}>{children}</Shell>;
}
