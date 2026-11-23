import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchCalibration, type BgmInputs, type CalibrationResponse, type HwInputs, type NormalInputs, type SabrInputs } from "../../api/calibration";
import { LineChart } from "../LineChart";

// Components of the calibration chapter (Coral-Book II-6). The reader moves the inputs of the normal/Black
// comparison, the SABR beta, the Hull-White reference parameters and the BGM correlation decay; each change asks the
// R API (rmql).

type Req = { normal: NormalInputs; sabr: SabrInputs; hw: HwInputs; bgm: BgmInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  normal: { forwardPct: 0.56, blackVolPct: 40, normalVolBp: 40, expiry: 2 },
  sabr: { beta: 0.5 },
  hw: { aPct: 8, sigmaPct: 1.2, zeroPct: 3 },
  bgm: { decay: 0.45 },
};

interface CState {
  data: CalibrationResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<CState | null>(null);

export function CalibrationProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<CalibrationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchCalibration(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: CState = {
    data, loading, error, req,
    set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })),
    reset: (s) => setReq((x) => ({ ...x, [s]: DEFAULT[s] })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useC(): CState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useC must be used inside CalibrationProvider");
  return s;
}
function Need({ children }: { children: (d: CalibrationResponse) => ReactNode }) {
  const { data, error } = useC();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: CalibrationResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const pct = (x: number, n = 4) => `${f(x * 100, n)}%`;
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));

export function CalibrationStatus() {
  const { error, loading } = useC();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const FIELDS: Record<Section, Field[]> = {
  normal: [
    { key: "forwardPct", label: "フォワード（%）", step: 0.05, min: -1, max: 5 },
    { key: "blackVolPct", label: "Black ボラ（%）", step: 1, min: 1, max: 200 },
    { key: "normalVolBp", label: "Normal ボラ（bp）", step: 1, min: 1, max: 500 },
    { key: "expiry", label: "満期（年）", step: 0.5, min: 0.1, max: 30 },
  ],
  sabr: [{ key: "beta", label: "β（固定）", step: 0.1, min: 0, max: 1 }],
  hw: [
    { key: "aPct", label: "基準の a（%）", step: 0.5, min: 0.5, max: 50 },
    { key: "sigmaPct", label: "基準の σ（%）", step: 0.1, min: 0.05, max: 5 },
    { key: "zeroPct", label: "ゼロ金利（%）", step: 0.25, min: -1, max: 10 },
  ],
  bgm: [{ key: "decay", label: "相関の減衰（基準）", step: 0.05, min: 0.02, max: 1.9 }],
};
const NAMES: Record<Section, string> = { normal: "Normal・Black", sabr: "SABR", hw: "Hull–White", bgm: "BGM" };

export function CalibrationControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data } = useC();
  return (
    <div className="controls" role="group" aria-label={`${NAMES[which]}の前提`} data-section={which}>
      {FIELDS[which].map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`${NAMES[which]}：${fd.label}`}
            value={(req[which] as unknown as Record<string, number>)[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set(which, { [fd.key]: v } as never); }} />
        </label>
      ))}
      <button type="button" onClick={() => reset(which)}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

const pctTicks = (lo: number, hi: number, step: number) => { const t = []; for (let v = lo; v <= hi + 1e-9; v += step) t.push({ x: v, label: `${Number(v.toFixed(2))}%` }); return t; };

/** Call by a normal and a Black volatility, across strikes, and the units. */
export function NormalPanel() {
  return (
    <Need>
      {(d) => {
        const n = d.normal;
        const pts = (k: "normal" | "black") => n.by_strike.filter((r) => r[k] != null).map((r) => ({ x: r.strike * 100, y: 1e4 * (r[k] as number), date: `行使金利 ${f(r.strike * 100, 2)}%` }));
        return (
          <div className="two-col">
            <div>
              <div className="table-wrap">
                <table className="data">
                  <caption>Black・Normal ボラティリティの単位と、アット・ザ・マネーの価格（フォワード {pct(n.forward, 2)}、満期 {n.expiry} 年、割引なし）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">market_label</th><th scope="col" className="num">model_input</th><th scope="col">meaning</th><th scope="col" className="num">ATM コール（bp）</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">Black {f(n.black_volatility * 100, 1)}%</th><td className="num">{f(n.black_volatility, 4)}</td><td>相対変動の年率</td><td className="num" data-testid="atm-black">{n.atm.black == null ? "定義されない（F ≤ 0）" : f(1e4 * n.atm.black, 4)}</td></tr>
                    <tr><th scope="row">Normal {f(n.normal_volatility * 1e4, 1)}bp</th><td className="num">{f(n.normal_volatility, 6)}</td><td>金利の絶対変動の年率</td><td className="num" data-testid="atm-normal">{f(1e4 * n.atm.normal, 4)}</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="note">{n.forward > 0
                ? <>アット・ザ・マネーでは σ<sub>N</sub> ≈ σ<sub>B</sub> × F なので、Black {f(n.black_volatility * 100, 1)}% はおよそ Normal {f(n.atm_normal_equivalent_bp, 1)}bp に当たります。</>
                : <>フォワードが 0 以下なので Black 型の価格は定義されません。Normal 型だけが価格を与えます。</>}</p>
            </div>
            <LineChart title="行使金利とコールの価格：Normal 型は負の行使金利でも定義され、Black 型は正の行使金利だけ" origin="2026-01-01" xMin={-1} xMax={2.5}
              xTicks={pctTicks(-1, 2.5, 0.5)} xLabel="行使金利" yLabel="価格（bp）"
              series={[
                { key: "n", label: `Normal ${f(n.normal_volatility * 1e4, 0)}bp`, color: "var(--series-1)", points: pts("normal") },
                { key: "b", label: `Black ${f(n.black_volatility * 100, 0)}%`, color: "var(--series-2)", dashed: true, points: pts("black") },
              ]}
              markers={[{ x: n.forward * 100, label: "F" }, { x: 0, label: "0%" }]} formatY={(y) => `${y.toFixed(3)}bp`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** SABR smile, two fits, the residuals. */
export function SabrPanel() {
  return (
    <Need>
      {(d) => {
        const s = d.sabr;
        const line = (k: "manuscript_fit" | "rmql_fit") => s.smile.map((r) => ({ x: r.strike * 100, y: r[k] * 100, date: `行使金利 ${f(r.strike * 100, 2)}%` }));
        const market = s.quotes.map((r) => ({ x: r.strike * 100, y: r.market * 100, date: `市場 ${f(r.strike * 100, 2)}%` }));
        return (
          <div className="two-col">
            <LineChart title={`市場と SABR モデルのボラティリティ・スマイル（β = ${s.beta}、満期 ${s.expiry} 年、フォワード ${pct(s.forward, 2)}）`} origin="2026-01-01"
              xMin={0} xMax={3} xTicks={pctTicks(0, 3, 0.5)} xLabel="行使金利" yLabel="Black ボラティリティ（%）"
              series={[
                { key: "m", label: "準ニュートン法（L-BFGS-B）", color: "var(--series-1)", points: line("manuscript_fit") },
                { key: "r", label: "Levenberg–Marquardt法", color: "var(--series-2)", dashed: true, points: line("rmql_fit") },
                { key: "q", label: "市場クォート（説明用）", color: "var(--series-3)", points: [], dots: market },
              ]}
              markers={[{ x: s.forward * 100, label: "F" }]} formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="table-wrap">
                <table className="data">
                  <caption>SABR 推定結果（β は固定）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">method</th><th scope="col" className="num">alpha</th><th scope="col" className="num">volvol（ν）</th><th scope="col" className="num">rho</th>
                    <th scope="col" className="num">RMSE（ボラの bp）</th><th scope="col" className="num">評価・反復回数</th><th scope="col" className="num">convergence</th></tr></thead>
                  <tbody>{s.fits.map((r, i) => (
                    <tr key={r.method}><th scope="row">{r.method}</th><td className="num" data-testid={`sabr-alpha-${i}`}>{f(r.alpha, 8)}</td><td className="num">{f(r.nu, 8)}</td><td className="num">{f(r.rho, 8)}</td>
                      <td className="num" data-testid={`sabr-rmse-${i}`}>{f(r.rmse * 1e4, 4)}</td><td className="num">{r.iterations}</td><td className="num">{r.convergence}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>SABR 市場クォートの再評価（残差はボラティリティの bp）</caption>
                  <thead><tr><th scope="col" className="num">行使金利</th><th scope="col" className="num">市場</th><th scope="col" className="num">L-BFGS-B</th><th scope="col" className="num">残差</th>
                    <th scope="col" className="num">LM法</th><th scope="col" className="num">残差</th></tr></thead>
                  <tbody>{s.quotes.map((r) => (
                    <tr key={r.strike}><th scope="row" className="num">{pct(r.strike, 2)}</th><td className="num">{pct(r.market, 2)}</td><td className="num">{pct(r.manuscript_fit, 4)}</td>
                      <td className="num">{f(1e4 * (r.manuscript_fit - r.market), 2)}</td><td className="num">{pct(r.rmql_fit, 4)}</td><td className="num">{f(1e4 * (r.rmql_fit - r.market), 2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }}
    </Need>
  );
}

/** Hull-White bond options, two fits, repricing and the unused option. */
export function HullWhitePanel() {
  return (
    <Need>
      {(d) => {
        const h = d.hw;
        const slice = h.objective_slice.map((r) => ({ x: r.a * 100, y: Math.log10(Math.max(r.objective, 1e-12)), date: `a = ${f(r.a * 100, 1)}%` }));
        return (
          <div className="two-col">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="table-wrap">
                <table className="data">
                  <caption>Hull–White パラメータ推定（基準 a = {pct(h.reference.a, 2)}、σ = {pct(h.reference.sigma, 2)}、ゼロ金利 {pct(h.zero_rate, 2)}）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">method</th><th scope="col" className="num">a</th><th scope="col" className="num">sigma</th><th scope="col" className="num">objective（bp²）</th>
                    <th scope="col" className="num">評価回数</th><th scope="col" className="num">convergence</th></tr></thead>
                  <tbody>{h.fits.map((r, i) => (
                    <tr key={r.method}><th scope="row">{r.method}</th><td className="num" data-testid={`hw-a-${i}`}>{pct(r.a, 6)}</td><td className="num" data-testid={`hw-sigma-${i}`}>{pct(r.sigma, 6)}</td>
                      <td className="num">{sci(r.objective)}</td><td className="num">{r.evaluations ?? "—"}</td><td className="num">{r.convergence}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>適合点と未使用点の再評価（価格は額面1の債券に対する bp）</caption>
                  <thead><tr><th scope="col">オプション満期／債券満期</th><th scope="col">用途</th><th scope="col" className="num">行使価格</th><th scope="col" className="num">市場</th>
                    <th scope="col" className="num">準ニュートン法</th><th scope="col" className="num">誤差</th><th scope="col" className="num">Levenberg–Marquardt</th><th scope="col" className="num">誤差</th></tr></thead>
                  <tbody>{h.options.map((r) => (
                    <tr key={`${r.option_maturity}-${r.bond_maturity}`} className={r.sample === "validation" ? "changed" : undefined}>
                      <th scope="row">{r.option_maturity}年／{r.bond_maturity}年</th><td>{r.sample === "fit" ? "適合" : "検証（未使用）"}</td><td className="num">{f(r.strike, 6)}</td>
                      <td className="num">{f(1e4 * r.market_price, 4)}</td><td className="num">{f(1e4 * r.manuscript_price, 4)}</td><td className="num">{f(1e4 * (r.manuscript_price - r.market_price), 4)}</td>
                      <td className="num">{f(1e4 * r.rmql_price, 4)}</td><td className="num">{sci(1e4 * (r.rmql_price - r.market_price))}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <LineChart title={`目的関数の a に沿った断面（σ は基準の ${pct(h.reference.sigma, 2)} に固定、縦軸は log₁₀）`} origin="2026-01-01" xMin={1} xMax={20}
              xTicks={[1, 5, 10, 15, 20].map((x) => ({ x, label: `${x}%` }))} xLabel="平均回帰 a" yLabel="log₁₀ J（bp²）"
              series={[{ key: "j", label: "目的関数", color: "var(--series-1)", points: slice }]}
              markers={[{ x: h.fits[0].a * 100, label: "L-BFGS-B" }, { x: h.fits[1].a * 100, label: "LM法" }]}
              formatY={(y) => `10^${y.toFixed(2)}`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** Fixed-weight proxy and Rebonato's approximation against the correlation decay. */
export function BgmPanel() {
  return (
    <Need>
      {(d) => {
        const b = d.bgm;
        const pt = (k: "proxy" | "rebonato") => b.by_decay.map((r) => ({ x: r.decay, y: r[k] * 100, date: `減衰 ${f(r.decay, 2)}` }));
        return (
          <div className="two-col">
            <div className="table-wrap">
              <table className="data">
                <caption>BGM キャリブレーションの説明用・固定ウェイト近似と Rebonato の近似　<Tag d={d} /></caption>
                <tbody>
                  {b.caplet_vol.map((v, i) => <tr key={i}><th scope="row">Caplet volatility {i + 1}（ウェイト {b.weights[i]}）</th><td className="num">{pct(v, 2)}</td></tr>)}
                  <tr><th scope="row">Swaption volatility proxy（減衰 {b.decay}）</th><td className="num" data-testid="bgm-proxy">{pct(b.proxy_vol, 6)}</td></tr>
                  <tr><th scope="row">Fitted correlation decay</th><td className="num" data-testid="bgm-decay">{f(b.fitted_decay, 6)}</td></tr>
                  <tr><th scope="row">Rebonato の近似のスワップション・ボラ（フォワード {pct(b.lmm_forward, 0)} は仮定）</th><td className="num">{pct(b.rebonato_vol, 6)}</td></tr>
                  <tr><th scope="row">相関モデルから推定した減衰</th><td className="num">{f(b.rebonato_fitted_decay, 6)}</td></tr>
                </tbody>
              </table>
            </div>
            <LineChart title="相関の減衰とスワップション・ボラティリティ：減衰が大きいほど相関が下がり、ボラは小さくなる" origin="2026-01-01" xMin={0} xMax={2}
              xTicks={[0, 0.5, 1, 1.5, 2].map((x) => ({ x, label: String(x) }))} xLabel="相関の減衰 β" yLabel="スワップション・ボラ（%）"
              series={[
                { key: "p", label: "固定ウェイト近似", color: "var(--series-1)", points: pt("proxy") },
                { key: "r", label: "Rebonato の近似", color: "var(--series-2)", dashed: true, points: pt("rebonato") },
              ]}
              markers={[{ x: b.decay, label: `基準 ${b.decay}` }]} formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}
