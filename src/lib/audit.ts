import "server-only";
import { db } from "./db";
import { auditLogs } from "@/db/schema";
import { clientIp } from "./request";
import { requestArea } from "./context";

/** Registra um evento. A área (CONSOLE ou APP) vem da requisição, salvo quando informada. */
export async function audit(entry: {
  action: string; area?: "CONSOLE" | "APP"; userId?: string | null; userEmail?: string | null;
  entity?: string; entityId?: string; data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const area = entry.area ?? ((await requestArea()).area === "console" ? "CONSOLE" : "APP");
    await db.insert(auditLogs).values({ ...entry, area, ip: await clientIp() });
  } catch (err) {
    console.error("[audit] falha ao registrar:", (err as Error).message);
  }
}
