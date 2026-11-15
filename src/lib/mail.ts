import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

/**
 * Envio de e-mail pelo SMTP configurado (SMTP_HOST…). Sem SMTP:
 *  - em desenvolvimento, o conteúdo vai para o log do servidor (para testar a recuperação de senha);
 *  - em produção, registra que o e-mail não foi enviado (sem o conteúdo, que pode ter um link de acesso).
 */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!env.SMTP_HOST) {
    if (env.isProd) { console.warn(`[mail] SMTP não configurado: e-mail "${subject}" não enviado.`); return false; }
    console.log(`[mail] (desenvolvimento) para ${to}: ${subject}\n${text}`);
    return true;
  }
  try {
    const t = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === "true",
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error("[mail] falha ao enviar:", (err as Error).message);
    return false;
  }
}
