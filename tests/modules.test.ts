import { describe, expect, it } from "vitest";
import { computeAccess, moduleForPath } from "../src/lib/modules";

describe("catálogo de rotas", () => {
  it("acha o módulo pelo prefixo", () => {
    expect(moduleForPath("/financeiro/receber")).toBe("financeiro");
    expect(moduleForPath("/paineis")).toBe("paineis");
    expect(moduleForPath("/academico/alunos")).toBe("academico");
    expect(moduleForPath("/usuarios/abc")).toBe("admin");
    expect(moduleForPath("/api/export/fin-dre")).toBe("financeiro");
    expect(moduleForPath("/api/export/acad-alunos")).toBe("academico");
  });
  it("não confunde prefixos parecidos", () => {
    expect(moduleForPath("/financeirox")).toBeNull();
    expect(moduleForPath("/")).toBeNull();
    expect(moduleForPath("/conta")).toBeNull();
  });
});

describe("acesso por perfil (NONE/VIEW/EDIT)", () => {
  const all = ["financeiro", "paineis", "academico"];
  it("administrador edita tudo que está liberado", () => {
    expect(computeAccess({ isAdmin: true, enabled: all }).mods).toEqual({ admin: "EDIT", financeiro: "EDIT", paineis: "EDIT", academico: "EDIT" });
  });
  it("módulo não liberado pelo fornecedor fica sem acesso até para o administrador", () => {
    expect(computeAccess({ isAdmin: true, enabled: ["financeiro"] }).mods.academico).toBe("NONE");
  });
  it("usuário com perfil segue o perfil e nunca vê a Administração", () => {
    const a = computeAccess({ isAdmin: false, enabled: all, profile: { name: "Secretaria", permissions: { financeiro: "VIEW", academico: "EDIT", admin: "EDIT" } } });
    expect(a.mods).toEqual({ admin: "NONE", financeiro: "VIEW", paineis: "NONE", academico: "EDIT" });
  });
  it("valor desconhecido no perfil vira NONE", () => {
    expect(computeAccess({ isAdmin: false, enabled: all, profile: { name: "x", permissions: { financeiro: "editar" } } }).mods.financeiro).toBe("NONE");
  });
  it("usuário sem perfil edita os módulos liberados", () => {
    expect(computeAccess({ isAdmin: false, enabled: ["paineis"] }).mods).toEqual({ admin: "NONE", financeiro: "NONE", paineis: "EDIT", academico: "NONE" });
  });
});
