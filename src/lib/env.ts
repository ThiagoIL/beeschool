// Sem "server-only": o middleware (runtime Node.js) também usa este arquivo. Nunca importe em componentes do navegador.
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  /** chave das sessões e dos links de senha (mínimo 32 caracteres). Trocar desconecta todo mundo. */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET precisa ter pelo menos 32 caracteres"),
  /** endereço público do sistema (ex.: https://sistema.beeschool.com.br), usado nos links dos e-mails */
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url("APP_URL precisa ser um endereço completo, com https://").optional()),
  /** caminho do console do fornecedor (padrão /sistema-admin; escolha algo pouco óbvio) */
  PLATFORM_ADMIN_PATH: z.string().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  TRUST_PROXY: z.enum(["true", "false"]).default("true"),
  // e-mail (recuperação de senha). Sem SMTP_HOST, o link é só registrado no log em desenvolvimento.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  MAIL_FROM: z.string().default("Bee School <nao-responda@localhost>"),
  PASSWORD_RESET_MINUTES: z.coerce.number().int().min(10).max(24 * 60).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Configuração inválida: ${msg}`);
}

export const env = {
  ...parsed.data,
  isProd: process.env.NODE_ENV === "production",
  cookieSecure: parsed.data.COOKIE_SECURE ? parsed.data.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
};
