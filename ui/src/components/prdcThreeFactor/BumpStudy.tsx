import { useEffect, useState } from "react";
import { fetchBumpStudy, type BumpStudyResponse } from "../../api/prdcThreeFactor";
import { useT } from "./index";

// The finite difference against the bump width: the relative error to the automatic-differentiation value, on log axes.
// Large widths leave a truncation error, small widths a round-off error; automatic differentiation has no width (its line is 0).

const W = 720, H = 300, M = { top: 16, right: 20, bottom: 46, left: 64 };
const sci = (x: number) => x.toExponential(2);

export function BumpStudy() {
  const { req } = useT();
  const [study, setStudy] = useState<BumpStudyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("gamma");
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const id = window.setTimeout(() => {
      fetchBumpStudy(req, { signal: c.signal })
        .then((d) => { setStudy(d); setError(null); })
        .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e)); });
    }, 500);
    return () => { c.abort(); window.clearTimeout(id); };
  }, [req]);
  if (error) return <p className="error-text" role="alert">{error}</p>;
  if (!study) return <p className="muted">バンプ幅ごとの誤差を計算中…（数秒）</p>;
  const s = study.studies.find((x) => x.key === key) ?? study.studies[0];
  const pts = s.points.filter((p) => p.relative_error > 0);
  const lx = (m: number) => Math.log10(m);
  const ly = (e: number) => Math.log10(e);
  const xMin = -3, xMax = 3;
  const yLo = Math.floor(Math.min(...pts.map((p) => ly(p.relative_error)))), yHi = Math.ceil(Math.max(...pts.map((p) => ly(p.relative_error))));
  const x = (m: number) => M.left + ((lx(m) - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const y = (e: number) => M.top + ((yHi - ly(e)) / Math.max(1, yHi - yLo)) * (H - M.top - M.bottom);
  const best = pts.reduce((a, p) => (p.relative_error < a.relative_error ? p : a), pts[0]);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.multiplier).toFixed(1)},${y(p.relative_error).toFixed(1)}`).join(" ");
  const yTicks: number[] = []; for (let v = yLo; v <= yHi; v++) yTicks.push(v);
  const hp = hover !== null ? pts[hover] : null;
  return (
    <div data-testid="bump-study">
      <div className="controls" role="group" aria-label="感応度の選択">
        <label>感応度{" "}
          <select value={key} onChange={(e) => { setKey(e.target.value); setHover(null); }} aria-label="バンプ幅の検証：感応度">
            {study.studies.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <span className="controls-state">自動微分の値 <b data-testid="bump-ad">{s.automatic_differentiation.toLocaleString("en-US", { maximumFractionDigits: 3 })}</b>（誤差 0、幅なし）</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${s.label}：バンプ幅と有限差分の相対誤差`} style={{ maxWidth: W }}>
        {yTicks.map((v) => (
          <g key={v}><line x1={M.left} x2={W - M.right} y1={y(10 ** v)} y2={y(10 ** v)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(10 ** v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">1e{v}</text></g>
        ))}
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
          <g key={v}><line x1={x(10 ** v)} x2={x(10 ** v)} y1={H - M.bottom} y2={H - M.bottom + 4} stroke="var(--text-muted)" />
            <text x={x(10 ** v)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{v === 0 ? "×1（画面の幅）" : `×1e${v}`}</text></g>
        ))}
        <line x1={x(1)} x2={x(1)} y1={M.top} y2={H - M.bottom} stroke="var(--text-muted)" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={p.multiplier} cx={x(p.multiplier)} cy={y(p.relative_error)} r={hover === i ? 5 : 3} fill="var(--series-1)"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        <circle cx={x(best.multiplier)} cy={y(best.relative_error)} r={7} fill="none" stroke="var(--series-2)" strokeWidth={2} />
        <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize={12} fill="var(--text-muted)">バンプ幅（{s.unit}、画面で使う幅に対する倍率）</text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="var(--text-muted)">相対誤差（対 自動微分）</text>
      </svg>
      <p className="note" data-testid="bump-readout">
        {hp ? <>倍率 {hp.multiplier.toPrecision(3)}（幅 {sci(hp.width)}）：有限差分 {hp.finite_difference.toLocaleString("en-US", { maximumFractionDigits: 3 })}、相対誤差 {sci(hp.relative_error)}</>
          : <>最小は倍率 {best.multiplier.toPrecision(3)}（幅 {sci(best.width)}）で相対誤差 {sci(best.relative_error)}。画面の幅（×1）は {sci(s.chosen_width)}、相対誤差 {sci(s.points.find((p) => p.multiplier === 1)?.relative_error ?? NaN)}。</>}
      </p>
      <details><summary>読み方</summary><p className="note">{study.conventions.note}</p></details>
    </div>
  );
}
