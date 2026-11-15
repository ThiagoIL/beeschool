import Link from "next/link";
import { BrandPanel } from "./Brand";
import { Field, Form, Submit } from "./Form";
import { loginAction } from "@/server/auth-actions";

export function LoginScreen({ title, subtitle, tag, admin }: { title: string; subtitle: string; tag: string; admin?: boolean }) {
  return (
    <main className="login">
      <BrandPanel tag={tag} />
      <section className="login-side">
        <div className="login-form">
          <h1>{title}</h1>
          <p className="lead">{subtitle}</p>
          <Form action={loginAction} className="stack">
            <Field name="email" label="E-mail" type="email" autoComplete="username" required />
            <Field name="senha" label="Senha" type="password" autoComplete="current-password" required />
            <Submit block pending="Entrando…">Entrar</Submit>
          </Form>
          {admin
            ? <p className="login-row muted" style={{ fontSize: 13 }}>Esqueceu a senha? Peça a outro administrador do console para redefinir.</p>
            : <p className="login-row"><Link href="/esqueci-senha">Esqueci minha senha</Link></p>}
        </div>
      </section>
    </main>
  );
}
