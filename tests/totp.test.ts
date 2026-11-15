import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newTotpSecret, openSecret, sealSecret, totpAt, verifyTotp } from "../src/lib/totp";

// vetores da RFC 6238 (SHA-1, segredo "12345678901234567890"), últimos 6 dígitos
const RFC = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (2FA do console)", () => {
  it("base32 ida e volta", () => expect(base32Decode(base32Encode(Buffer.from("abcdefghij"))).toString()).toBe("abcdefghij"));
  it("confere com os vetores da RFC 6238", () => {
    expect(totpAt(RFC, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(RFC, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("aceita 1 passo de diferença e devolve o passo usado", () => {
    const now = 1_700_000_000_000, step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC, totpAt(RFC, step), null, now)).toBe(step);
    expect(verifyTotp(RFC, totpAt(RFC, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC, totpAt(RFC, step - 3), null, now)).toBeNull();
  });
  it("não aceita o mesmo código duas vezes", () => {
    const now = 1_700_000_000_000, step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC, totpAt(RFC, step), step, now)).toBeNull();
  });
  it("recusa formato inválido", () => expect(verifyTotp(RFC, "12ab56", null)).toBeNull());
  it("cifra e decifra o segredo; chave errada não abre", () => {
    const s = newTotpSecret();
    const sealed = sealSecret(s, "x".repeat(32));
    expect(sealed).not.toContain(s);
    expect(openSecret(sealed, "x".repeat(32))).toBe(s);
    expect(openSecret(sealed, "y".repeat(32))).toBeNull();
  });
});
