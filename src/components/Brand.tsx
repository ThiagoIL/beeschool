/** Lado da marca nas telas de entrada: logos das duas escolas sobre o fundo de favo de mel. */
export function BrandPanel({ tag }: { tag?: string }) {
  return (
    <section className="login-art">
      {tag && <span className="tag">{tag}</span>}
      <div className="brand-pair">
        <img src="/brand/beeschool.jpg" alt="Bee Christian School" width={170} height={145} />
        <span aria-hidden="true">&amp;</span>
        <img src="/brand/belight.jpg" alt="Be Light Christian School" width={170} height={120} />
      </div>
      <div>
        <h2 className="login-title">Visão <span>financeira</span></h2>
        <p>Contas a receber e a pagar, extrato por banco, mensalidades, DRE e indicadores das escolas num só lugar.</p>
      </div>
    </section>
  );
}
