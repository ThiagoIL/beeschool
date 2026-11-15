import { Field, Form, Submit } from "./Form";
import { changePasswordAction, confirmTwoFactorAction, disableTwoFactorAction } from "@/server/auth-actions";
import { EndSessionButton, EndOthersButton, TwoFactorStart } from "./AccountUI";
import { fmtDateTime } from "@/lib/format";

export type SessionRow = { id: string; current: boolean; device: string; ip: string | null; since: Date; lastSeen: Date };

const deviceOf = (ua: string | null) => {
  if (!ua) return "Aparelho desconhecido";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return [br, os].filter(Boolean).join(" · ");
};
export const toSessionRows = (rows: { id: string; userAgent: string | null; ip: string | null; createdAt: Date; lastSeenAt: Date }[], currentId: string): SessionRow[] =>
  rows.map((r) => ({ id: r.id, current: r.id === currentId, device: deviceOf(r.userAgent), ip: r.ip, since: r.createdAt, lastSeen: r.lastSeenAt }));

export function AccountPage({ user, mustChange, roleLabel, sessions, twoFactor }: {
  user: { name: string; email: string }; mustChange: boolean; roleLabel: string; sessions: SessionRow[];
  /** só no console: estado do autenticador */
  twoFactor?: { enabled: boolean; required: boolean };
}) {
  return (
    <>
      <div className="ph"><div><h1>Minha conta</h1><p>{user.name} · {user.email} · {roleLabel}</p></div></div>
      {mustChange && <div className="alert warn">Por segurança, troque a senha provisória antes de continuar.</div>}
      {twoFactor?.required && !twoFactor.enabled && !mustChange && <div className="alert warn">O console exige autenticação em dois fatores. Configure o aplicativo autenticador abaixo para continuar.</div>}
      <div className="grid2">
        <section className="panel">
          <h2>Trocar senha</h2>
          <div className="pb">
            <Form action={changePasswordAction}>
              <Field name="senha_atual" label="Senha atual" type="password" autoComplete="current-password" required full />
              <Field name="senha_nova" label="Nova senha" type="password" required full hint="Mínimo de 10 caracteres, com letras maiúsculas, minúsculas e números." />
              <Field name="senha_confirma" label="Repita a nova senha" type="password" required full />
              <div className="full form-foot"><Submit>Trocar senha</Submit></div>
            </Form>
            <p className="muted" style={{ fontSize: 12.5 }}>Ao trocar, as outras sessões abertas com a sua conta são encerradas.</p>
          </div>
        </section>
        {twoFactor && !mustChange && (
          <section className="panel">
            <h2>Autenticação em dois fatores</h2>
            <div className="pb">
              {twoFactor.enabled ? (
                <>
                  <div className="alert ok">Ativa. O console pede o código do aplicativo a cada entrada.</div>
                  <details><summary>Trocar de celular ou desativar</summary>
                    <Form action={disableTwoFactorAction}>
                      <Field name="senha" label="Senha atual" type="password" autoComplete="current-password" required />
                      <Field name="codigo" label="Código atual do aplicativo" autoComplete="one-time-code" required maxLength={6} />
                      <div className="full form-foot"><Submit variant="danger" confirm={twoFactor.required ? "Desativar o autenticador? Você vai precisar configurar de novo para usar o console." : "Desativar o autenticador? O console volta a pedir só e-mail e senha."}>Desativar</Submit></div>
                    </Form>
                  </details>
                </>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>{twoFactor.required ? "" : "Opcional, mas recomendado: protege o console mesmo se a senha vazar. "}Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…) no celular.</p>
                  <TwoFactorStart account={user.email} />
                  <Form action={confirmTwoFactorAction}>
                    <Field name="codigo" label="Código de 6 dígitos mostrado no aplicativo" autoComplete="one-time-code" required maxLength={6} full />
                    <div className="full form-foot"><Submit>Ativar</Submit></div>
                  </Form>
                </>
              )}
            </div>
          </section>
        )}
      </div>
      <section className="panel" style={{ marginTop: 18 }}>
        <h2>Sessões ativas <span className="muted h-sub">aparelhos conectados com a sua conta</span>{sessions.length > 1 && <span style={{ marginLeft: "auto" }}><EndOthersButton /></span>}</h2>
        <div className="tbl solo" style={{ border: 0 }}><table>
          <thead><tr><th>Aparelho</th><th>IP</th><th>Entrou em</th><th>Último uso</th><th /></tr></thead>
          <tbody>{sessions.map((s) => (
            <tr key={s.id}><td>{s.device}{s.current && <span className="badge ok" style={{ marginLeft: 8 }}>Esta sessão</span>}</td><td>{s.ip ?? "—"}</td><td>{fmtDateTime(s.since)}</td><td>{fmtDateTime(s.lastSeen)}</td>
              <td className="acts show">{!s.current && <EndSessionButton id={s.id} />}</td></tr>))}</tbody>
        </table></div>
      </section>
    </>
  );
}
