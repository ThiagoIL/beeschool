// Sem "server-only": o middleware (runtime Node.js) também usa este arquivo. Nunca importe em componentes do navegador.
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  ROOT_DOMAIN: z.string().min(1, "ROOT_DOMAIN é obrigatório (ex.: beeschool.com.br)"),
  ADMIN_SUBDOMAIN: z.string().regex(/^[a-z0-9-]+$/).default("admin"),
  /** chave para cifrar os segredos do 2FA (mínimo 32 caracteres; nunca troque depois de em uso) */
  APP_SECRET: z.string().min(32, "APP_SECRET precisa ter pelo menos 32 caracteres"),
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
  /** 2FA no console: opcional (ativado por cada administrador em Minha conta). Mude para true para obrigar. */
  twoFactorRequired: false,
  cookieSecure: parsed.data.COOKIE_SECURE ? parsed.data.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
};
