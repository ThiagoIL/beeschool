"use server";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { passwordResets, users, type User } from "@/db/schema";
import { appSession, consoleSession, getSystem, needsTwoFactorSetup, requestArea } from "@/lib/context";
import { createSession, destroySession, readSession, revokeOtherSessions, revokeOwnSession, revokeUserSessions, type Area } from "@/lib/session";
import { sha256, systemBlocked } from "@/lib/session-core";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { newTotpSecret, openSecret, sealSecret, verifyTotp } from "@/lib/totp";
import { hit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { sessionLimitError } from "@/lib/limits";
import { formObject, keepValues, zEmail } from "@/lib/forms";
import { consoleHref } from "@/lib/console-path";
import type { ActionState } from "@/lib/action";

const GENERIC = "E-mail, senha ou código inválidos.";
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

/** Área da requisição no formato das sessões, e o caminho de cada tela nessa área. */
async function areaInfo(): Promise<{ area: Area; href: (p: string) => string }> {
  const console = (await requestArea()).area === "console";
  return { area: console ? "CONSOLE" : "APP", href: console ? (p) => consoleHref(p) : (p) => p };
}

/** Contas do console e da escola são separadas: o login de cada área só aceita as suas. */
const roleScope = (area: Area) => (area === "CONSOLE" ? eq(users.role, "SUPER_ADMIN") : ne(users.role, "SUPER_ADMIN"));

/** Registra uma tentativa errada; na 5ª, bloqueia a conta por 15 minutos. */
async function countFailure(user: User) {
  const fails = user.failedLogins + 1;
  await db.update(users).set({ failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil }).where(eq(users.id, user.id));
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const parsed = z.object({ email: zEmail, senha: z.string().min(1).max(200), codigo: z.string().max(12).optional() }).safeParse(raw);
  if (!parsed.success) return { error: "Informe o e-mail e a senha.", values: keepValues(raw) };
  const { email, senha, codigo } = parsed.data;
  const { area, href } = await areaInfo();
  const ip = await clientIp();

  if (!(await hit(`login:ip:${ip}`, 30, 15 * 60))) return { error: "Muitas tentativas a partir desta rede. Aguarde alguns minutos e tente de novo.", values: keepValues(raw) };
  if (area === "APP" && systemBlocked(await getSystem())) return { error: "O acesso está suspenso. Fale com o suporte.", redirectTo: "/suspenso" };
  if (!(await hit(`login:conta:${area}:${email}`, 10, 15 * 60))) return { error: "Muitas tentativas para este e-mail. Aguarde alguns minutos.", values: keepValues(raw) };

  const [user] = await db.select().from(users).where(and(eq(users.email, email), roleScope(area))).limit(1);

  if (user && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await verifyPassword(senha, null); // mesmo tempo de resposta
    return { error: `Conta bloqueada temporariamente por tentativas erradas. Tente de novo em até ${LOCK_MINUTES} minutos.`, values: keepValues(raw) };
  }
  // usuário inexistente também passa pelo bcrypt (hash fictício): o tempo de resposta não revela quais e-mails existem
  const passOk = await verifyPassword(senha, user ? user.passwordHash : null);

  if (!user || !passOk || user.status !== "ACTIVE") {
    if (user && !passOk) await countFailure(user);
    await audit({ action: "login.falhou", userId: user?.id, userEmail: email, data: { motivo: !user ? "usuario_inexistente" : !passOk ? "senha" : "inativo" } });
    return { error: GENERIC, values: keepValues(raw) };
  }

  // 2FA do console (opcional): quem ativou o autenticador precisa informar o código
  let step: number | null = null;
  if (area === "CONSOLE" && user.totpEnabledAt && user.totpSecret) {
    const secret = openSecret(user.totpSecret, env.AUTH_SECRET);
    step = secret ? verifyTotp(secret, codigo ?? "", user.totpLastStep) : null;
    if (step == null) {
      if (codigo) await countFailure(user);
      await audit({ action: "login.falhou", userId: user.id, userEmail: email, data: { motivo: codigo ? "codigo_2fa" : "sem_codigo_2fa" } });
      return { error: codigo ? GENERIC : "Informe o código de 6 dígitos do aplicativo autenticador.", fields: { codigo: "Código obrigatório." }, values: keepValues(raw) };
    }
  }

  if (area === "APP") {
    const full = await sessionLimitError(user.id);
    if (full) { await audit({ action: "login.limite", userId: user.id, userEmail: user.email }); return { error: full, values: keepValues(raw) }; }
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql`now()`, ...(step != null ? { totpLastStep: step } : {}) }).where(eq(users.id, user.id));
  await createSession(user, area);
  await audit({ action: "login.entrou", userId: user.id, userEmail: user.email });
  return { ok: true, redirectTo: user.mustChangePassword ? href("/conta?trocar=1") : area === "CONSOLE" && needsTwoFactorSetup(user) ? href("/conta?2fa=1") : href("/") };
}

export async function logoutAction(): Promise<void> {
  const { area } = await areaInfo();
  const s = area === "CONSOLE" ? await consoleSession() : await readSession("APP");
  await destroySession(area);
  if (s) await audit({ action: "login.saiu", userId: s.user.id, userEmail: s.user.email });
}

/** Sessão atual da área, inclusive com troca de senha ou 2FA pendente. */
async function currentSession() {
  const info = await areaInfo();
  return { ...info, s: info.area === "CONSOLE" ? await consoleSession() : await appSession() };
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { area, href, s } = await currentSession();
  if (!s) return { error: "Sua sessão expirou. Entre novamente.", redirectTo: href("/login") };
  const raw = formObject(fd);
  const atual = raw.senha_atual ?? "", nova = raw.senha_nova ?? "", conf = raw.senha_confirma ?? "";
  const bad = (k: string, m: string): ActionState => ({ fields: { [k]: m }, error: "Confira os campos destacados." });
  if (!(await hit(`senha:${s.user.id}`, 10, 15 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  if (!(await verifyPassword(atual, s.user.passwordHash))) return bad("senha_atual", "Senha atual incorreta.");
  const prob = passwordProblem(nova, s.user.email);
  if (prob) return bad("senha_nova", prob);
  if (nova !== conf) return bad("senha_confirma", "As senhas não conferem.");
  if (await verifyPassword(nova, s.user.passwordHash)) return bad("senha_nova", "A nova senha precisa ser diferente da atual.");

  const [updated] = await db.update(users)
    .set({ passwordHash: await hashPassword(nova), passwordChangedAt: sql`now()`, mustChangePassword: false, failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, s.user.id)).returning();
  // encerra todas as sessões (inclusive em outros aparelhos) e abre uma nova aqui
  await revokeUserSessions(s.user.id);
  await createSession(updated, area);
  await audit({ action: "senha.alterada", userId: s.user.id, userEmail: s.user.email });
  if (s.user.mustChangePassword) return { ok: true, message: "Senha alterada.", redirectTo: area === "CONSOLE" && needsTwoFactorSetup(s.user) ? href("/conta?2fa=1") : href("/") };
  return { ok: true, message: "Senha alterada. As outras sessões abertas com a sua conta foram encerradas." };
}

// ------------------------------------------------------------------------------------
// Recuperação de senha por e-mail (só usuários da escola; o console redefine pela tela de administradores)
// ------------------------------------------------------------------------------------
const FORGOT_OK = "Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. Confira também a caixa de spam.";

/** Endereço público do sistema para os links do e-mail: APP_URL ou o domínio acessado. */
async function publicBase(): Promise<string> {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = (h.get("host") ?? "localhost").split(",")[0].trim();
  return `${env.cookieSecure ? "https" : "http"}://${host}`;
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = zEmail.safeParse(raw.email);
  if (!p.success) return { fields: { email: "Informe um e-mail válido." }, error: "Confira o e-mail.", values: keepValues(raw) };
  const email = p.data;
  if ((await requestArea()).area !== "app") return { error: "Acesse pelo endereço do sistema." };
  const ip = await clientIp();
  if (!(await hit(`reset:ip:${ip}`, 10, 60 * 60)) || !(await hit(`reset:conta:${email}`, 3, 60 * 60))) return { ok: true, message: FORGOT_OK };
  if (systemBlocked(await getSystem())) return { ok: true, message: FORGOT_OK };

  const [user] = await db.select().from(users).where(and(eq(users.email, email), ne(users.role, "SUPER_ADMIN"))).limit(1);
  if (user && user.status === "ACTIVE") {
    const token = randomBytes(32).toString("base64url");
    await db.update(passwordResets).set({ usedAt: sql`now()` }).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + env.PASSWORD_RESET_MINUTES * 60_000), ip });
    await sendMail(user.email, "Bee School — criar nova senha",
      `Olá, ${user.name}.\n\nRecebemos um pedido para criar uma nova senha. Use o link abaixo em até ${env.PASSWORD_RESET_MINUTES} minutos:\n\n${await publicBase()}/redefinir-senha?token=${token}\n\nSe não foi você, ignore este e-mail: a sua senha atual continua valendo.`);
    await audit({ action: "senha.recuperacao_pedida", userId: user.id, userEmail: user.email });
  } else {
    await audit({ action: "senha.recuperacao_ignorada", userEmail: email });
  }
  return { ok: true, message: FORGOT_OK };
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const token = (raw.token ?? "").slice(0, 100);
  const nova = raw.senha_nova ?? "", conf = raw.senha_confirma ?? "";
  if (!(await hit(`reset:usar:${await clientIp()}`, 20, 60 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const [row] = await db.select({ r: passwordResets, u: users }).from(passwordResets).innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, sql`now()`))).limit(1);
  if (!row || row.u.role === "SUPER_ADMIN" || row.u.status !== "ACTIVE") return { error: "Este link é inválido ou já expirou. Peça um novo em “Esqueci minha senha”." };
  const prob = passwordProblem(nova, row.u.email);
  if (prob) return { fields: { senha_nova: prob }, error: "Confira os campos destacados." };
  if (nova !== conf) return { fields: { senha_confirma: "As senhas não conferem." }, error: "Confira os campos destacados." };
  await db.update(passwordResets).set({ usedAt: sql`now()` }).where(eq(passwordResets.id, row.r.id));
  await db.update(users).set({ passwordHash: await hashPassword(nova), passwordChangedAt: sql`now()`, mustChangePassword: false, failedLogins: 0, lockedUntil: null }).where(eq(users.id, row.u.id));
  await revokeUserSessions(row.u.id);
  await audit({ action: "senha.redefinida_por_email", userId: row.u.id, userEmail: row.u.email });
  return { ok: true, message: "Senha criada. Entre com a nova senha.", redirectTo: "/login" };
}

// ------------------------------------------------------------------------------------
// 2FA do console (aplicativo autenticador, opcional)
// ------------------------------------------------------------------------------------
async function adminForSetup() {
  if ((await requestArea()).area !== "console") return null;
  return readSession("CONSOLE");
}

/** Gera um segredo novo (ainda não ativo). A ativação exige um código válido dele. */
export async function startTwoFactorAction(): Promise<{ secret?: string; error?: string }> {
  const s = await adminForSetup();
  if (!s || s.user.mustChangePassword) return { error: "Sua sessão expirou. Entre novamente." };
  if (s.user.totpEnabledAt) return { error: "O autenticador já está ativo. Para trocar de aparelho, desative e ative de novo." };
  const secret = newTotpSecret();
  await db.update(users).set({ totpSecret: sealSecret(secret, env.AUTH_SECRET), totpLastStep: null }).where(eq(users.id, s.user.id));
  return { secret };
}

export async function confirmTwoFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminForSetup();
  if (!s) return { error: "Sua sessão expirou. Entre novamente.", redirectTo: consoleHref("/login") };
  if (!(await hit(`2fa:${s.user.id}`, 10, 15 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const [u] = await db.select().from(users).where(eq(users.id, s.user.id)).limit(1);
  const secret = u?.totpSecret ? openSecret(u.totpSecret, env.AUTH_SECRET) : null;
  if (!u || !secret) return { error: "Gere o código QR antes de confirmar." };
  const step = verifyTotp(secret, String(fd.get("codigo") ?? ""), null);
  if (step == null) return { fields: { codigo: "Código incorreto. Confira o horário do celular." }, error: "Confira o código." };
  await db.update(users).set({ totpEnabledAt: sql`now()`, totpLastStep: step }).where(eq(users.id, u.id));
  await revokeOtherSessions(u.id, s.sessionId);
  await audit({ action: "2fa.ativado", userId: u.id, userEmail: u.email });
  return { ok: true, message: "Autenticador ativado. A partir de agora o console pede o código ao entrar.", redirectTo: consoleHref("/") };
}

/** Desativa o 2FA (exige senha e código atuais). */
export async function disableTwoFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminForSetup();
  if (!s || !s.user.totpEnabledAt || !s.user.totpSecret) return { error: "Sua sessão expirou. Entre novamente.", redirectTo: consoleHref("/login") };
  if (!(await hit(`2fa:${s.user.id}`, 10, 15 * 60))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  if (!(await verifyPassword(String(fd.get("senha") ?? ""), s.user.passwordHash))) return { fields: { senha: "Senha incorreta." }, error: "Confira os campos." };
  const secret = openSecret(s.user.totpSecret, env.AUTH_SECRET);
  if (!secret || verifyTotp(secret, String(fd.get("codigo") ?? ""), s.user.totpLastStep) == null) return { fields: { codigo: "Código incorreto." }, error: "Confira os campos." };
  await db.update(users).set({ totpEnabledAt: null, totpSecret: null, totpLastStep: null }).where(eq(users.id, s.user.id));
  await audit({ action: "2fa.desativado", userId: s.user.id, userEmail: s.user.email });
  return env.twoFactorRequired
    ? { ok: true, message: "Autenticador desativado. Configure de novo para voltar a usar o console.", redirectTo: consoleHref("/conta?2fa=1") }
    : { ok: true, message: "Autenticador desativado. O console volta a pedir só e-mail e senha.", redirectTo: consoleHref("/conta") };
}

// ------------------------------------------------------------------------------------
// Sessões ativas (Minha conta)
// ------------------------------------------------------------------------------------
export async function endSessionAction(sessionId: string): Promise<ActionState> {
  const { s, href } = await currentSession();
  if (!s) return { error: "Sua sessão expirou. Entre novamente.", redirectTo: href("/login") };
  if (sessionId === s.sessionId) return { error: "Esta é a sessão que você está usando. Use Sair." };
  if (!(await revokeOwnSession(s.user.id, String(sessionId).slice(0, 64)))) return { error: "Sessão não encontrada." };
  await audit({ action: "sessao.encerrada", userId: s.user.id, userEmail: s.user.email });
  return { ok: true, message: "Sessão encerrada." };
}

export async function endOtherSessionsAction(): Promise<ActionState> {
  const { s, href } = await currentSession();
  if (!s) return { error: "Sua sessão expirou. Entre novamente.", redirectTo: href("/login") };
  const n = await revokeOtherSessions(s.user.id, s.sessionId);
  await audit({ action: "sessao.encerradas_outras", userId: s.user.id, userEmail: s.user.email, data: { quantidade: n } });
  return { ok: true, message: n ? `${n} ${n === 1 ? "sessão encerrada" : "sessões encerradas"}.` : "Não havia outras sessões abertas." };
}
