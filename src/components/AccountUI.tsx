"use client";
import { ActionButton } from "./client";
import { endOtherSessionsAction, endSessionAction } from "@/server/auth-actions";

export function EndSessionButton({ id }: { id: string }) {
  return <ActionButton className="btn btn-sm" action={() => endSessionAction(id)} confirm="Encerrar esta sessão? O aparelho precisará entrar de novo.">Encerrar</ActionButton>;
}
export function EndOthersButton() {
  return <ActionButton className="btn btn-sm" action={endOtherSessionsAction} confirm="Encerrar todas as outras sessões da sua conta?">Encerrar as outras</ActionButton>;
}

