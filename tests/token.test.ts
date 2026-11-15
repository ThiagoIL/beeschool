import { describe, expect, it } from "vitest";
import { hmacToken } from "../src/lib/token";

/** O hash dos tokens depende do AUTH_SECRET: trocar a chave invalida todas as sessões e links de senha. */
describe("hash dos tokens com o AUTH_SECRET", () => {
  const a = "a".repeat(40), b = "b".repeat(40);
  it("é estável para a mesma chave", () => {
    expect(hmacToken(a, "token")).toBe(hmacToken(a, "token"));
    expect(hmacToken(a, "token")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("muda quando a chave muda (todo mundo é desconectado)", () => expect(hmacToken(b, "token")).not.toBe(hmacToken(a, "token")));
  it("tokens diferentes, hashes diferentes", () => expect(hmacToken(a, "token-1")).not.toBe(hmacToken(a, "token-2")));
});
