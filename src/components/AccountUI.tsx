"use client";
import { useState } from "react";
import QRCode from "qrcode";
import { ActionButton } from "./client";
import { endOtherSessionsAction, endSessionAction, startTwoFactorAction } from "@/server/auth-actions";
import { toast } from "./Toast";

export function EndSessionButton({ id }: { id: string }) {
  return <ActionButton className="btn btn-sm" action={() => endSessionAction(id)} confirm="Encerrar esta sessão? O aparelho precisará entrar de novo.">Encerrar</ActionButton>;
}
export function EndOthersButton() {
  return <ActionButton className="btn btn-sm" action={endOtherSessionsAction} confirm="Encerrar todas as outras sessões da sua conta?">Encerrar as outras</ActionButton>;
}

/** Gera o segredo e mostra o QR code (montado no próprio navegador) e a chave para digitar. */
export function TwoFactorStart({ account }: { account: string }) {
  const [d, setD] = useState<{ qr: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return d ? (
    <div className="qr-box">
      <img src={d.qr} alt="QR code para o aplicativo autenticador" width={180} height={180} />
      <div><p style={{ marginTop: 0 }}>Leia o código com o aplicativo ou digite a chave:</p><code className="secret">{d.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
        <p className="muted" style={{ fontSize: 12.5 }}>Depois, informe abaixo o código de 6 dígitos que aparecer.</p></div>
    </div>
  ) : (
    <p><button type="button" className="btn" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await startTwoFactorAction();
      setBusy(false);
      if (r.error || !r.secret) { toast(r.error ?? "Não foi possível gerar.", true); return; }
      const uri = `otpauth://totp/${encodeURIComponent("Bee School")}:${encodeURIComponent(account)}?secret=${r.secret}&issuer=${encodeURIComponent("Bee School")}&algorithm=SHA1&digits=6&period=30`;
      setD({ qr: await QRCode.toDataURL(uri, { margin: 1, width: 360 }), secret: r.secret });
    }}>{busy ? "Gerando…" : "Gerar QR code"}</button></p>
  );
}
