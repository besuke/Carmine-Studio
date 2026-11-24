import { useState } from "react";
import { fetchDerivativeCost, type DerivativeCostResponse } from "../../api/prdcThreeFactor";
import { useT } from "./index";

// The ten second derivatives: the valuations and the measured time of automatic differentiation (one call) against finite differences.
// The measurement runs when the button is pressed (it takes a few seconds), not at every change of an input.

const ms = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)} ミリ秒`;

export function DerivativeCost() {
  const { req } = useT();
  const [d, setD] = useState<DerivativeCostResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true); setError(null);
    fetchDerivativeCost(req).then(setD).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const maxMs = d ? Math.max(d.automatic_differentiation.milliseconds, d.finite_difference.milliseconds) : 1;
  return (
    <div data-testid="derivative-cost">
      <div className="controls">
        <button type="button" onClick={run} disabled={busy}>{busy ? "計測中…（数秒）" : d ? "もう一度計測する" : "計測する"}</button>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
      {d && (
        <>
          <div className="tiles">
            <div className="tile"><div className="tile-label">自動微分（10項目すべて）</div>
              <div className="tile-value" data-testid="cost-ad-valuations">{d.automatic_differentiation.valuations} 回</div>
              <div className="tile-note" data-testid="cost-ad-ms">{ms(d.automatic_differentiation.milliseconds)}</div></div>
            <div className="tile"><div className="tile-label">有限差分（10項目すべて）</div>
              <div className="tile-value" data-testid="cost-fd-valuations">{d.finite_difference.valuations} 回</div>
              <div className="tile-note" data-testid="cost-fd-ms">{ms(d.finite_difference.milliseconds)}</div></div>
            <div className="tile"><div className="tile-label">有限差分 ÷ 自動微分</div>
              <div className="tile-value">{d.ratio.valuations.toFixed(0)} 倍（回数）</div>
              <div className="tile-note" data-testid="cost-ratio">{d.ratio.time.toFixed(1)} 倍（時間）</div></div>
          </div>
          <svg viewBox="0 0 720 110" width="100%" style={{ maxWidth: 720 }} role="img" aria-label="自動微分と有限差分の計算時間">
            {[["自動微分", d.automatic_differentiation.milliseconds, "var(--series-1)"], ["有限差分", d.finite_difference.milliseconds, "var(--series-2)"]].map(([label, v, color], i) => (
              <g key={label as string}>
                <text x={0} y={30 + i * 44} fontSize={12} fill="var(--text-muted)">{label as string}</text>
                <rect x={70} y={14 + i * 44} width={Math.max(2, ((v as number) / maxMs) * 520)} height={26} fill={color as string} />
                <text x={76 + Math.max(2, ((v as number) / maxMs) * 520)} y={32 + i * 44} fontSize={12} fill="currentColor">{ms(v as number)}</text>
              </g>
            ))}
          </svg>
          <div className="table-wrap">
            <table className="data">
              <caption>有限差分に要する価格の再評価（基準の価値 1 回を共有）</caption>
              <thead><tr><th scope="col">2階の項目</th><th scope="col" className="num">有限差分（回）</th><th scope="col" className="num">自動微分（回）</th></tr></thead>
              <tbody>
                {d.items.map((r) => <tr key={r.item}><th scope="row">{r.item}</th><td className="num">{r.finite_difference_valuations}</td><td className="num">—</td></tr>)}
                <tr><th scope="row">基準の価値</th><td className="num">1</td><td className="num">—</td></tr>
                <tr><th scope="row">合計</th><td className="num">{d.finite_difference.valuations}</td><td className="num">{d.automatic_differentiation.valuations}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="note">価値の評価1回は {ms(d.single_valuation_ms)}。{d.conventions.note}　時間は {d.reps} 回の中央値。</p>
        </>
      )}
    </div>
  );
}
