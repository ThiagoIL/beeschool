import { describe, expect, it } from "vitest";
import { canChangeRole, canChangeStatus, canDelete, canManage, canResetPassword, type Actor, type Target } from "../src/lib/rules";

const master: Target = { id: "m", role: "SUPER_ADMIN", isMaster: true, status: "ACTIVE" };
const masterActor: Actor = { id: "m", role: "SUPER_ADMIN" };
const otherSuper: Target = { id: "s2", role: "SUPER_ADMIN", isMaster: false, status: "ACTIVE" };
const superActor: Actor = { id: "s2", role: "SUPER_ADMIN" };
const tAdmin: Actor = { id: "a1", role: "ADMIN" };
const tAdminTarget: Target = { id: "a1", role: "ADMIN", isMaster: false, status: "ACTIVE" };
const tUser: Target = { id: "u1", role: "USER", isMaster: false, status: "ACTIVE" };
const otherUser: Target = { id: "u9", role: "USER", isMaster: false, status: "ACTIVE" };

describe("conta master", () => {
  it("não pode rebaixar a si mesma", () => expect(canChangeRole(masterActor, master, "USER").ok).toBe(false));
  it("não pode se desativar", () => expect(canChangeStatus(masterActor, master, "INACTIVE").ok).toBe(false));
  it("não pode se excluir", () => expect(canDelete(masterActor, master).ok).toBe(false));
  it("não redefine a própria senha sem informar a atual", () => expect(canResetPassword(masterActor, master).ok).toBe(false));
  it("outro administrador do sistema não desativa, exclui nem redefine a master", () => {
    expect(canChangeStatus(superActor, master, "INACTIVE").ok).toBe(false);
    expect(canDelete(superActor, master).ok).toBe(false);
    expect(canResetPassword(superActor, master).ok).toBe(false);
  });
});

describe("administrador do sistema", () => {
  it("gerencia os usuários da escola", () => expect(canManage(superActor, otherUser).ok).toBe(true));
  it("não move usuário entre sistema e empresa", () => expect(canChangeRole(masterActor, otherSuper, "ADMIN").ok).toBe(false));
  it("não altera o próprio nível", () => expect(canChangeRole(superActor, otherSuper, "ADMIN").ok).toBe(false));
});

describe("administrador da empresa", () => {
  it("não enxerga as contas do console", () => expect(canManage(tAdmin, otherSuper).ok).toBe(false));
  it("não enxerga administradores do sistema", () => expect(canManage(tAdmin, master).ok).toBe(false));
  it("promove usuário da própria empresa", () => expect(canChangeRole(tAdmin, tUser, "ADMIN").ok).toBe(true));
  it("não promove ninguém a administrador do sistema", () => expect(canChangeRole(tAdmin, tUser, "SUPER_ADMIN").ok).toBe(false));
  it("não rebaixa nem desativa a si mesmo", () => {
    expect(canChangeRole(tAdmin, tAdminTarget, "USER").ok).toBe(false);
    expect(canChangeStatus(tAdmin, tAdminTarget, "INACTIVE").ok).toBe(false);
  });
});

describe("usuário comum", () => {
  it("não gerencia ninguém", () => expect(canManage({ id: "u1", role: "USER" }, tUser).ok).toBe(false));
});
