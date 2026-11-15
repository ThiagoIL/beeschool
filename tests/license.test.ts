import { describe, expect, it } from "vitest";
import { daysToBlock, licenseBlock } from "../src/lib/license";

describe("licença e bloqueio automático", () => {
  const ok = { status: "ACTIVE" as const, paidUntil: "2026-11-10", graceDays: 5 };
  it("sem vencimento nunca bloqueia", () => expect(licenseBlock({ ...ok, paidUntil: null }, "2030-01-01")).toBeNull());
  it("dentro da tolerância continua liberado", () => {
    expect(licenseBlock(ok, "2026-11-10")).toBeNull();
    expect(licenseBlock(ok, "2026-11-15")).toBeNull();
  });
  it("bloqueia no dia seguinte ao fim da tolerância", () => expect(licenseBlock(ok, "2026-11-16")).toEqual({ reason: "OVERDUE", since: "2026-11-16" }));
  it("tolerância zero bloqueia no dia seguinte ao vencimento", () => expect(licenseBlock({ ...ok, graceDays: 0 }, "2026-11-11")?.reason).toBe("OVERDUE"));
  it("suspensão manual vale mesmo com licença paga", () => expect(licenseBlock({ ...ok, status: "SUSPENDED", paidUntil: "2099-01-01" }, "2026-11-15")?.reason).toBe("SUSPENDED"));
  it("conta os dias até o bloqueio", () => {
    expect(daysToBlock(ok, "2026-11-12")).toBe(3);
    expect(daysToBlock({ ...ok, paidUntil: null }, "2026-11-12")).toBeNull();
  });
});
