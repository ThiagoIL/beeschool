import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { Field, Form, Submit } from "@/components/Form";
import { createTenantAction } from "@/server/admin-actions";

export async function AdminNewTenant() {
  await requireAdmin();
  return (
    <>
      <div className="ph"><div><Link className="back" href="/clientes">‹ Clientes</Link><h1>Novo cliente</h1><p>Cria o cliente e o primeiro administrador dele, com uma senha provisória. Em instalação única, normalmente já foi criado na instalação.</p></div></div>
      <section className="panel" style={{ maxWidth: 760 }}>
        <div className="pb">
          <Form action={createTenantAction}>
            <Field name="nome" label="Nome do cliente" required full />
            <Field name="slug" label="Subdomínio" required placeholder="msuassuna" hint={`Endereço de acesso: subdominio.${process.env.ROOT_DOMAIN}. Letras minúsculas, números e hífen.`} />
            <Field name="documento" label="CNPJ" placeholder="00.000.000/0000-00" />
            <div className="full"><h2 style={{ margin: "8px 0 0" }}>Plano de usuários</h2></div>
            <Field name="max_usuarios" label="Usuários cadastrados (máximo)" type="number" placeholder="Sem limite" hint="Vazio = sem limite. Conta o administrador." />
            <Field name="max_simultaneos" label="Usuários simultâneos (máximo)" type="number" placeholder="Sem limite" hint="Conectados ao mesmo tempo. Vazio = sem limite." />
            <div className="full"><h2 style={{ margin: "8px 0 0" }}>Primeiro administrador</h2></div>
            <Field name="admin_nome" label="Nome" required />
            <Field name="admin_email" label="E-mail" type="email" required />
            <div className="full form-foot"><Link className="btn" href="/clientes">Voltar</Link><Submit pending="Criando…">Criar empresa</Submit></div>
          </Form>
        </div>
      </section>
    </>
  );
}
