/**
 * Autenticação em dois fatores (TOTP, RFC 6238: 6 dígitos, 30 s, SHA-1), compatível com
 * Google Authenticator, Microsoft Authenticator, Authy etc. Sem dependências.
 * O segredo é guardado cifrado (AES-256-GCM) com a chave derivada de AUTH_SECRET.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

/** Código de 6 dígitos para um passo de 30 segundos. */
export function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 30_000);

/**
 * Confere o código aceitando 1 passo de diferença no relógio. Devolve o passo aceito
 * (para gravar e impedir que o mesmo código seja usado de novo) ou null.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepOf(now);
  for (const s of [cur - 1, cur, cur + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    const a = Buffer.from(totpAt(secret, s)), b = Buffer.from(c);
    if (timingSafeEqual(a, b)) return s;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "Bee School"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- cifra do segredo ----------
const keyOf = (appSecret: string) => createHash("sha256").update("bee-school:totp:" + appSecret).digest();

export function sealSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(appSecret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function openSecret(sealed: string, appSecret: string): string | null {
  try {
    const [v, iv, tag, enc] = sealed.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", keyOf(appSecret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
