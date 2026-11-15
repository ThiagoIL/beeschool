import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandPanel } from "@/components/Brand";
import { getSystem } from "@/lib/context";
import { systemBlocked } from "@/lib/session-core";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acesso suspenso" };

/** Tela mostrada enquanto o sistema está bloqueado (manual ou licença vencida). Vale na hora: cada requisição confere. */
export default async function Suspenso() {
  const t = await getSystem();
  const b = systemBlocked(t);
  if (!b) redirect("/login");
  return (
    <main className="login">
      <BrandPanel tag={t.name} />
      <section className="login-side">
        <div className="login-form">
          <span className="lock-badge"><Icon name="lock" size={28} /></span>
          <h1>Acesso suspenso</h1>
          <p className="lead">{t.blockMessage || (b.reason === "OVERDUE" ? "A licença de uso do sistema venceu. Fale com o fornecedor para regularizar e liberar o acesso." : "O acesso ao sistema está temporariamente suspenso. Fale com o fornecedor.")}</p>
          <p className="muted" style={{ fontSize: 13 }}>Os dados continuam guardados com segurança. Assim que o acesso for liberado, é só entrar de novo.</p>
        </div>
      </section>
    </main>
  );
}
