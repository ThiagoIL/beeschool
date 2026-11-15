import type { NextRequest } from "next/server";
import { appSession, getSystem } from "@/lib/context";
import { accessOf } from "@/lib/access";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { EXPORTS } from "@/server/exports";
import { csvResponse } from "@/server/csv";

export const dynamic = "force-dynamic";

/** Downloads em CSV (listas e relatórios). Respeita o acesso de consulta de cada módulo. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const ex = Object.prototype.hasOwnProperty.call(EXPORTS, tipo) ? EXPORTS[tipo] : null;
  if (!ex) return new Response("Relatório não encontrado.", { status: 404 });
  const s = await appSession();
  if (!s) return new Response("Sessão expirada. Entre novamente.", { status: 401 });
  const access = await accessOf({ ...s, system: await getSystem() });
  if (access.mods[ex.mod] === "NONE") return new Response("Sem acesso.", { status: 403 });
  const sp = Object.fromEntries([...req.nextUrl.searchParams.entries()].map(([k, v]) => [k, v.slice(0, 200)]));
  const { name, csv } = await db.transaction((tx) => ex.run(tx, sp));
  await audit({ action: "exportacao.baixada", userId: s.user.id, userEmail: s.user.email, entity: "relatorio", entityId: tipo });
  return csvResponse(name, csv);
}
