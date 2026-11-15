import { requestArea } from "@/lib/context";
import { AdminHome } from "@/views/admin/home";
import { TenantHome } from "@/views/tenant/home";
import { BrandPanel } from "@/components/Brand";

type SP = Promise<Record<string, string | undefined>>;
export default async function Inicio({ searchParams }: { searchParams: SP }) {
  const info = await requestArea();
  if (info.area === "admin") return <AdminHome />;
  if (info.area === "tenant") return <TenantHome searchParams={searchParams} />;
  return (
    <main className="login">
      <BrandPanel />
      <section className="login-side">
        <div className="login-form">
          <h1>Bee School</h1>
          <p className="lead">Acesse pelo endereço da sua instituição, no formato <b>suaescola.{process.env.ROOT_DOMAIN}</b>.</p>
        </div>
      </section>
    </main>
  );
}
