import { describe, expect, it } from "vitest";
import { consoleBase, consoleHref, stripConsoleBase } from "../src/lib/console-path";

describe("caminho do console", () => {
  it("padrão /sistema-admin", () => expect(consoleBase(undefined)).toBe("/sistema-admin"));
  it("normaliza barras e maiúsculas", () => expect(consoleBase("/Painel-Bee/")).toBe("/painel-bee"));
  it("recusa caminhos reservados da escola", () => {
    expect(consoleBase("/financeiro")).toBe("/sistema-admin");
    expect(consoleBase("/console")).toBe("/sistema-admin");
    expect(consoleBase("/")).toBe("/sistema-admin");
  });
  it("separa o caminho interno", () => {
    expect(stripConsoleBase("/sistema-admin", "/sistema-admin")).toBe("/");
    expect(stripConsoleBase("/sistema-admin/auditoria", "/sistema-admin")).toBe("/auditoria");
    expect(stripConsoleBase("/sistema-adminx", "/sistema-admin")).toBeNull();
    expect(stripConsoleBase("/financeiro", "/sistema-admin")).toBeNull();
  });
  it("monta endereços públicos", () => {
    expect(consoleHref("/", "/sistema-admin")).toBe("/sistema-admin");
    expect(consoleHref("/login", "/sistema-admin")).toBe("/sistema-admin/login");
  });
});
