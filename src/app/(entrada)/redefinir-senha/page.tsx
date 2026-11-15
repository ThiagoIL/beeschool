import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandPanel } from "@/components/Brand";
import { Field, Form, Hidden, Submit } from "@/components/Form";
import { resetPasswordAction } from "@/server/auth-actions";
import { requestArea } from "@/lib/context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Criar nova senha", referrer: "no-referrer" };

export default async function Redefinir({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const info = await requestArea();
  if (info.area !== "app") notFound();
  const token = ((await searchParams).token ?? "").slice(0, 100);
  return (
    <main className="login">
      <BrandPanel />
      <section className="login-side">
        <div className="login-form">
          <h1>Criar nova senha</h1>
          <p className="lead">A nova senha precisa ter pelo menos 10 caracteres, com letras maiúsculas, minúsculas e números.</p>
          {token ? (
            <Form action={resetPasswordAction} className="stack">
              <Hidden name="token" value={token} />
              <Field name="senha_nova" label="Nova senha" type="password" required />
              <Field name="senha_confirma" label="Repita a nova senha" type="password" required />
              <Submit block pending="Salvando…">Salvar nova senha</Submit>
            </Form>
          ) : <div className="alert bad">Link incompleto. Peça um novo em “Esqueci minha senha”.</div>}
          <p className="login-row"><Link href="/login">Voltar para entrar</Link></p>
        </div>
      </section>
    </main>
  );
}
