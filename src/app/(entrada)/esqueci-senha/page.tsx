import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandPanel } from "@/components/Brand";
import { Field, Form, Submit } from "@/components/Form";
import { forgotPasswordAction } from "@/server/auth-actions";
import { requestArea } from "@/lib/context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Esqueci minha senha" };

export default async function Esqueci() {
  const info = await requestArea();
  if (info.area !== "app") notFound();
  return (
    <main className="login">
      <BrandPanel />
      <section className="login-side">
        <div className="login-form">
          <h1>Esqueci minha senha</h1>
          <p className="lead">Informe o e-mail de acesso. Se ele estiver cadastrado, enviamos um link para criar uma nova senha.</p>
          <Form action={forgotPasswordAction} className="stack">
            <Field name="email" label="E-mail" type="email" autoComplete="username" required />
            <Submit block pending="Enviando…">Enviar link</Submit>
          </Form>
          <p className="login-row"><Link href="/login">Voltar para entrar</Link></p>
        </div>
      </section>
    </main>
  );
}
