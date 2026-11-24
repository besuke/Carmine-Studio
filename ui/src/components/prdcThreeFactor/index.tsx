import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchPrdcThreeFactor, type ThreeFactorInputs, type ThreeFactorResponse } from "../../api/prdcThreeFactor";

// Chapter 15's three-factor PRDC: the three correlations are the inputs; the value, the delta and the vega, the correlation
// sensitivities, the cross-gammas and the Vanna come back by automatic differentiation and by finite differences.

const DEFAULT: ThreeFactorInputs = { correlation: { domesticForeign: 0.3, domesticFx: -0.2, foreignFx: 0.4 } };
const FIELDS: { key: keyof ThreeFactorInputs["correlation"]; label: string; min: number; max: number }[] = [
  { key: "domesticForeign", label: "ρ（円金利, 外貨金利）", min: -0.99, max: 0.99 },
  { key: "domesticFx", label: "ρ（円金利, FX）", min: -0.99, max: 0.99 },
  { key: "foreignFx", label: "ρ（外貨金利, FX）", min: -0.99, max: 0.99 },
];

interface TState {
  data: ThreeFactorResponse | null; loading: boolean; error: string | null; req: ThreeFactorInputs;
  set: (p: Partial<ThreeFactorInputs["correlation"]>) => void; reset: () => void;
}
const Ctx = createContext<TState | null>(null);

export function ThreeFactorProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<ThreeFactorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchPrdcThreeFactor(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: TState = { data, loading, error, req, set: (p) => setReq((x) => ({ correlation: { ...x.correlation, ...p } })), reset: () => setReq(DEFAULT) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useT(): TState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useT must be used inside ThreeFactorProvider");
  return s;
}
const Tag = ({ d }: { d: ThreeFactorResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const yen = (x: number) => Math.round(x).toLocaleString("ja-JP");
const num = (x: number, n: number) => x.toLocaleString("ja-JP", { minimumFractionDigits: n, maximumFractionDigits: n });
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));

/** The three correlations. A set that is not a correlation matrix is refused by the API and shown as the message. */
export function ThreeFactorControls() {
  const { req, set, reset, loading, error, data } = useT();
  return (
    <div className="controls" role="group" aria-label="3因子 PRDC の相関" data-section="three-factor">
      {FIELDS.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={0.05} min={fd.min} max={fd.max} className="rate-input" aria-label={`3因子：${fd.label}`}
            value={req.correlation[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set({ [fd.key]: v }); }} />
        </label>
      ))}
      <button type="button" onClick={reset}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : error ? <span className="error-text" role="alert">{error}</span> : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

export function ThreeFactorValue() {
  const { data } = useT();
  if (!data) return <p className="muted">計算中…</p>;
  const g = data.greeks;
  return (
    <div className="tiles">
      <div className="tile emphasis"><div className="tile-label">現在価値（3因子、閉じた式）</div><div className="tile-value" data-testid="tf-npv">{yen(data.npv)} 円</div>
        <div className="tile-note">想定元本 1億円、コールなし</div></div>
      <div className="tile"><div className="tile-label">FX デルタ（自動微分）</div><div className="tile-value" data-testid="tf-delta">{yen(g.fx_delta)} 円</div><div className="tile-note">FX 1円あたり</div></div>
      <div className="tile"><div className="tile-label">FX ベガ（自動微分）</div><div className="tile-value" data-testid="tf-vega">{yen(g.fx_vega)} 円</div><div className="tile-note">ボラ 1（100%）あたり</div></div>
    </div>
  );
}

export function ThreeFactorTables() {
  const { data } = useT();
  if (!data) return <p className="muted">計算中…</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <caption>相関感応度（相関が +0.01 動いたときの現在価値の変化、円）　<Tag d={data} /></caption>
          <thead><tr><th scope="col">相関</th><th scope="col" className="num">自動微分</th><th scope="col" className="num">有限差分</th><th scope="col" className="num">差</th></tr></thead>
          <tbody>{data.correlation.map((r, i) => (
            <tr key={r.pair}><th scope="row">{r.pair}</th><td className="num" data-testid={`tf-rho-ad-${i}`}>{num(r.automatic_differentiation, 2)}</td>
              <td className="num" data-testid={`tf-rho-fd-${i}`}>{num(r.finite_difference, 2)}</td><td className="num">{sci(r.difference)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>クロスガンマと Vanna（円）　<Tag d={data} /></caption>
          <thead><tr><th scope="col">感応度</th><th scope="col">単位</th><th scope="col" className="num">2階自動微分</th><th scope="col" className="num">PV の4点差分</th><th scope="col" className="num">差</th></tr></thead>
          <tbody>{data.second_order.map((r, i) => (
            <tr key={r.item}><th scope="row">{r.item}</th><td>{r.unit}</td><td className="num" data-testid={`tf-2nd-ad-${i}`}>{num(r.automatic_differentiation, 3)}</td>
              <td className="num" data-testid={`tf-2nd-fd-${i}`}>{num(r.finite_difference, 3)}</td><td className="num">{sci(r.difference)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="note">{data.conventions.second_order}　{data.conventions.bump}</p>
    </>
  );
}
