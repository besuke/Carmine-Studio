import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchPrdcRisk, runPrdcJob, type JobScenario, type PrdcRiskResponse, type RiskInputs } from "../../api/prdcRisk";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of Part III's page: the PRDC of III-7 by automatic differentiation, in parallel and distributed.

const DEFAULT: RiskInputs = { market: { spot: 150, volPct: 12 }, mc: { paths: 20000, seed: 1234 }, threads: { paths: 400000 } };
type Section = keyof RiskInputs;
interface RState {
  data: PrdcRiskResponse | null; loading: boolean; error: string | null; req: RiskInputs;
  set: <S extends Section>(s: S, p: Partial<RiskInputs[S]>) => void; reset: () => void;
}
const Ctx = createContext<RState | null>(null);

export function PrdcRiskProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<PrdcRiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchPrdcRisk(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: RState = { data, loading, error, req, set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })), reset: () => setReq(DEFAULT) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useR(): RState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useR must be used inside PrdcRiskProvider");
  return s;
}
function Need({ children }: { children: (d: PrdcRiskResponse) => ReactNode }) {
  const { data, error } = useR();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: { response: { request_id: string } } }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const yen = (x: number) => Math.round(x).toLocaleString("ja-JP");
const pct = (x: number, n = 2) => `${f(x * 100, n)}%`;

export function PrdcRiskStatus() {
  const { error, loading } = useR();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

export function RiskControls({ which }: { which: "market" | "mc" | "threads" }) {
  const { req, set, reset, loading, data, error } = useR();
  return (
    <div className="controls" role="group" aria-label={which === "market" ? "市場の前提" : which === "mc" ? "モンテカルロ" : "スレッドの計測"} data-section={which}>
      {which === "market" && (
        <>
          <label>FX スポット（円）{" "}
            <input type="number" step={1} min={50} max={300} className="rate-input" aria-label="市場：FX スポット（円）" value={req.market.spot}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set("market", { spot: v }); }} />
          </label>
          <label>FX ボラ（%）{" "}
            <input type="number" step={0.5} min={1} max={60} className="rate-input" aria-label="市場：FX ボラ（%）" value={req.market.volPct}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set("market", { volPct: v }); }} />
          </label>
        </>
      )}
      {which === "mc" && (
        <>
          <label>パス数{" "}
            <select value={req.mc.paths} aria-label="モンテカルロ：パス数" onChange={(e) => set("mc", { paths: Number(e.target.value) })}>
              {[2000, 20000, 100000, 200000].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
            </select>
          </label>
          <label>seed{" "}
            <input type="number" step={1} min={1} className="rate-input" aria-label="モンテカルロ：seed" value={req.mc.seed}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isInteger(v) && v >= 1) set("mc", { seed: v }); }} />
          </label>
        </>
      )}
      {which === "threads" && (
        <label>計測するパス数{" "}
          <select value={req.threads.paths} aria-label="スレッド：パス数" onChange={(e) => set("threads", { paths: Number(e.target.value) })}>
            {[100000, 400000, 1000000].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
          </select>
        </label>
      )}
      <button type="button" onClick={reset}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : error ? <span className="error-text">{error}</span> : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

/** The note, the curves and the coupon. */
export function NotePanel() {
  return (
    <Need>
      {(d) => {
        const n = d.note;
        return (
          <div className="two-col">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="table-wrap">
                <table className="data">
                  <caption>PRDC の条件（想定元本 {yen(n.notional)} 円、5年、年1回）　<Tag d={d} /></caption>
                  <tbody>
                    <tr><th scope="row">クーポン</th><td>min({pct(n.cap, 0)}, max({pct(n.floor, 0)}, {pct(n.fixed_coupon, 0)} + {pct(n.leverage, 0)} × (S / {n.reference_fx} − 1)))</td></tr>
                    <tr><th scope="row">FX スポット・ボラ</th><td className="num">{d.inputs.market.spot} 円・{d.inputs.market.volPct}%</td></tr>
                    <tr><th scope="row">現在価値（閉じた式）</th><td className="num" data-testid="npv">{yen(d.ad.npv)} 円</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>各年の円金利と外貨金利（その年のあいだ一定）</caption>
                  <thead><tr><th scope="col" className="num">年</th><th scope="col" className="num">円金利</th><th scope="col" className="num">外貨金利</th></tr></thead>
                  <tbody>{n.curve.map((r) => <tr key={r.year}><th scope="row" className="num">{r.year}</th><td className="num">{pct(r.jpy_rate)}</td><td className="num">{pct(r.foreign_rate)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <LineChart title="PRDC のクーポン（FX に比例し、0% と 8% で頭打ち）" origin="2026-01-01" xMin={100} xMax={220}
              xTicks={[100, 125, 150, 175, 200, 220].map((x) => ({ x, label: String(x) }))} xLabel="FX（円）" yLabel="クーポン（%）"
              series={[{ key: "c", label: "クーポン", color: "var(--series-1)", points: d.payoff.map((r) => ({ x: r.fx, y: 100 * r.coupon, date: `FX ${r.fx} 円` })) }]}
              markers={[{ x: d.inputs.market.spot, label: "スポット" }]} formatY={(y) => `${y.toFixed(2)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** Every sensitivity at once by automatic differentiation, against bump and revalue. */
export function AdPanel() {
  return (
    <Need>
      {(d) => {
        const a = d.ad;
        const years = a.per_year.map((r) => r.year);
        const nodeBars = a.table.slice(2).map((r, i) => ({ x: years[i % 5] + (i < 5 ? -0.18 : 0.18), value: r.automatic_differentiation, series: i < 5 ? "jpy" : "fx",
          date: r.factor, label: "円／1bp" }));
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">自動微分</div><div className="tile-value" data-testid="ad-evals">評価 {a.evaluations.automatic_differentiation} 回</div>
                <div className="tile-note">{f(a.seconds.automatic_differentiation * 1000, 1)} ミリ秒で 12 の感応度</div></div>
              <div className="tile"><div className="tile-label">Bump & Revalue（中心差分）</div><div className="tile-value" data-testid="bump-evals">評価 {a.evaluations.bump_and_revalue} 回</div>
                <div className="tile-note">{f(a.seconds.bump_and_revalue * 1000, 1)} ミリ秒（自動微分の {f(a.seconds.bump_and_revalue / Math.max(a.seconds.automatic_differentiation, 1e-6), 0)} 倍）</div></div>
              <div className="tile"><div className="tile-label">二つの方法の差</div><div className="tile-value" data-testid="ad-gap">{Math.max(...a.table.map((r) => Math.abs(r.difference) / Math.max(1, Math.abs(r.bump_and_revalue)))).toExponential(1)}</div>
                <div className="tile-note">相対誤差の最大（中心差分の打ち切り誤差）</div></div>
            </div>
            <div className="two-col">
              <div className="table-wrap">
                <table className="data">
                  <caption>PRDC の感応度：自動微分と Bump & Revalue（円）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">リスクファクター</th><th scope="col" className="num">自動微分</th><th scope="col" className="num">Bump & Revalue</th><th scope="col" className="num">差</th></tr></thead>
                  <tbody>{a.table.map((r) => (
                    <tr key={r.factor}><th scope="row">{r.factor}</th><td className="num">{f(r.automatic_differentiation, 2)}</td><td className="num">{f(r.bump_and_revalue, 2)}</td>
                      <td className="num">{r.difference.toExponential(2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <FlowChart title="カーブの節点ごとの感応度（その年の節点のゼロ金利 +1bp あたり、円）" origin="2026-01-01" xMin={0.5} xMax={5.5} barWidth={0.32} yLabel="円／1bp" legend
                  xTicks={years.map((y) => ({ x: y, label: `${y}年` }))}
                  series={[{ key: "jpy", label: "円カーブ", color: "var(--series-1)" }, { key: "fx", label: "外貨カーブ", color: "var(--series-2)" }]}
                  bars={nodeBars} formatY={(y) => yen(y)} footer={<Tag d={d} />} />
                <div className="table-wrap">
                  <table className="data">
                    <caption>年ごとの金利に対する感応度（各年の金利 +1bp、円）</caption>
                    <thead><tr><th scope="col" className="num">年</th><th scope="col" className="num">円金利</th><th scope="col" className="num">外貨金利</th></tr></thead>
                    <tbody>{a.per_year.map((r) => (
                      <tr key={r.year}><th scope="row" className="num">{r.year}</th><td className="num">{f(r.jpy_rate_per_bp, 2)}</td><td className="num">{f(r.foreign_rate_per_bp, 2)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** The Monte Carlo with pathwise derivatives. */
export function McPanel() {
  return (
    <Need>
      {(d) => {
        const m = d.mc;
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>モンテカルロ（{m.paths.toLocaleString("ja-JP")} 本、seed {m.seed}）の現在価値と感応度。パスごとの自動微分（円）　<Tag d={d} /></caption>
              <thead><tr><th scope="col">項目</th><th scope="col" className="num">モンテカルロ</th><th scope="col" className="num">閉じた式</th></tr></thead>
              <tbody>
                <tr><th scope="row">現在価値（標準誤差）</th><td className="num" data-testid="mc-npv">{yen(m.npv)}（{yen(m.standard_error)}）</td><td className="num">{yen(d.ad.npv)}</td></tr>
                <tr><th scope="row">FX デルタ</th><td className="num">{f(m.fx_delta, 1)}</td><td className="num">{f(d.ad.table[0].automatic_differentiation, 1)}</td></tr>
                <tr><th scope="row">FX ベガ</th><td className="num">{yen(m.fx_vega)}</td><td className="num">{yen(d.ad.table[1].automatic_differentiation)}</td></tr>
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/** The Monte Carlo on 1, 2, 4 and 8 threads. */
export function ThreadsPanel() {
  return (
    <Need>
      {(d) => {
        const t = d.threads.table;
        const sp = t.map((r) => ({ x: r.threads, y: r.speedup, date: `${r.threads} スレッド` }));
        return (
          <div className="two-col">
            <div className="table-wrap">
              <table className="data">
                <caption>スレッド数とモンテカルロの時間（{d.threads.paths.toLocaleString("ja-JP")} 本、論理プロセッサ {d.machine.logical_processors}）　<Tag d={d} /></caption>
                <thead><tr><th scope="col" className="num">スレッド数</th><th scope="col" className="num">時間（秒）</th><th scope="col" className="num">速さの比</th>
                  <th scope="col" className="num">現在価値（円）</th><th scope="col" className="num">1スレッドとの差</th></tr></thead>
                <tbody>{t.map((r) => (
                  <tr key={r.threads}><th scope="row" className="num">{r.threads}</th><td className="num">{f(r.seconds, 3)}</td><td className="num">{f(r.speedup, 2)}</td>
                    <td className="num">{yen(r.npv)}</td><td className="num" data-testid={`thread-diff-${r.threads}`}>{r.difference_from_one_thread === 0 ? "0" : r.difference_from_one_thread.toExponential(2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <LineChart title="スレッド数と速さの比（点線は理想）" origin="2026-01-01" xMin={1} xMax={8} xTicks={[1, 2, 4, 8].map((x) => ({ x, label: String(x) }))}
              xLabel="スレッド数" yLabel="速さ（倍）"
              series={[{ key: "s", label: "実測", color: "var(--series-1)", points: sp, dots: sp }, { key: "i", label: "理想", color: "var(--text-muted)", dashed: true, points: t.map((r) => ({ x: r.threads, y: r.threads, date: `${r.threads} スレッド` })) }]}
              formatY={(y) => `${y.toFixed(2)} 倍`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

// ---- III-2 and III-3: the scenario grid split into jobs, dispatched by the browser to the R API ---------------------
type JobState = { id: number; scenarios: JobScenario[]; status: "queued" | "running" | "completed" | "failed"; lane: number | null;
  start: number | null; end: number | null; serverSeconds: number | null; worker: string | null; requestId: string | null; error: string | null };
const SPOTS = [120, 127.5, 135, 142.5, 150, 157.5, 165, 172.5, 180];
const VOLS = [8, 10, 12, 14, 16];

export function DistributedPanel() {
  const [jobSize, setJobSize] = useState(5);
  const [concurrency, setConcurrency] = useState(2);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [results, setResults] = useState<Map<number, { npv: number; fx_delta: number; fx_vega: number }>>(new Map());
  const [running, setRunning] = useState(false);
  const [wall, setWall] = useState<number | null>(null);
  const scenarios: JobScenario[] = SPOTS.flatMap((s, i) => VOLS.map((v, j) => ({ id: i * VOLS.length + j + 1, spot: s, volPct: v })));

  async function run() {
    const t0 = performance.now();
    const list: JobState[] = [];
    for (let k = 0; k < scenarios.length; k += jobSize) {
      list.push({ id: list.length + 1, scenarios: scenarios.slice(k, k + jobSize), status: "queued", lane: null, start: null, end: null, serverSeconds: null, worker: null, requestId: null, error: null });
    }
    setJobs(list.map((j) => ({ ...j })));
    setResults(new Map());
    setRunning(true); setWall(null);
    const state = list.map((j) => ({ ...j }));
    const update = (i: number, p: Partial<JobState>) => { state[i] = { ...state[i], ...p }; setJobs(state.map((j) => ({ ...j }))); };
    const found = new Map<number, { npv: number; fx_delta: number; fx_vega: number }>();
    let next = 0;
    // the scheduler: each lane takes the next queued job until none is left
    await Promise.all(Array.from({ length: concurrency }, async (_, lane) => {
      while (next < state.length) {
        const i = next++;
        update(i, { status: "running", lane, start: performance.now() - t0 });
        try {
          const r = await runPrdcJob(state[i].scenarios);
          for (const x of r.results) found.set(x.id, { npv: x.npv, fx_delta: x.fx_delta, fx_vega: x.fx_vega });
          setResults(new Map(found));
          update(i, { status: "completed", end: performance.now() - t0, serverSeconds: r.server_seconds, worker: r.worker, requestId: r.response.request_id });
        } catch (e) {
          update(i, { status: "failed", end: performance.now() - t0, error: e instanceof ApiError ? e.message : String(e) });
        }
      }
    }));
    setWall(performance.now() - t0);
    setRunning(false);
  }

  const done = jobs.filter((j) => j.status === "completed").length;
  const serverTotal = jobs.reduce((a, j) => a + (j.serverSeconds ?? 0), 0);
  const tMax = Math.max(1, ...jobs.map((j) => j.end ?? 0));
  // each job a thick segment on its lane; consecutive jobs alternate in colour, with a small gap between them
  const gap = 0.004 * tMax;
  const order = new Map<number, number>(); // the position of each job within its lane
  const seen = new Map<number, number>();
  for (const j of [...jobs].filter((x) => x.start != null).sort((x, y) => x.start! - y.start!)) {
    const k = seen.get(j.lane ?? 0) ?? 0;
    order.set(j.id, k); seen.set(j.lane ?? 0, k + 1);
  }
  const bars = jobs.filter((j) => j.start != null).map((j) => {
    const end = j.end ?? j.start!;
    const a0 = Math.min(j.start! + gap, end), a1 = Math.max(end - gap, a0);
    return {
      key: `j${j.id}`, label: `ジョブ ${j.id}`, inLegend: false, strokeWidth: 9,
      color: j.status === "failed" ? "var(--series-2)" : (order.get(j.id) ?? 0) % 2 ? "var(--series-3)" : "var(--series-1)",
      points: [{ x: a0, y: (j.lane ?? 0) + 1, date: `ジョブ ${j.id}` }, { x: a1, y: (j.lane ?? 0) + 1, date: `ジョブ ${j.id}` }],
    };
  });
  const bySpot = SPOTS.map((s) => {
    const vals = scenarios.filter((x) => x.spot === s).map((x) => results.get(x.id)?.npv).filter((v): v is number => v != null);
    return { spot: s, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, count: vals.length };
  });
  return (
    <>
      <div className="controls" role="group" aria-label="分散計算の条件" data-section="distributed">
        <label>1ジョブのシナリオ数{" "}
          <select value={jobSize} aria-label="分散：1ジョブのシナリオ数" disabled={running} onChange={(e) => setJobSize(Number(e.target.value))}>
            {[1, 3, 5, 9, 15, 45].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>同時に送るジョブ数{" "}
          <select value={concurrency} aria-label="分散：同時に送るジョブ数" disabled={running} onChange={(e) => setConcurrency(Number(e.target.value))}>
            {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" onClick={run} disabled={running} data-testid="run-jobs">{running ? "実行中…" : "ジョブを送る"}</button>
        <span className="controls-state" data-testid="jobs-progress">{jobs.length ? `${done} / ${jobs.length} ジョブ完了${wall != null ? `（全体 ${f(wall / 1000, 2)} 秒、サーバーの計算 ${f(serverTotal, 2)} 秒）` : ""}` : "まだ送っていません"}</span>
      </div>
      {jobs.length > 0 && (
        <>
          <LineChart title="ジョブの実行の流れ（横軸はブラウザで測った経過時間、縦軸は送り手のレーン）" origin="2026-01-01" xMin={0} xMax={tMax} height={Math.max(160, 60 + 40 * concurrency)}
            xTicks={[0, 0.25, 0.5, 0.75, 1].map((r) => ({ x: r * tMax, label: `${f((r * tMax) / 1000, 2)} 秒` }))} xLabel="経過時間" yLabel="レーン" tooltipRows={1} legend={false}
            series={bars.length ? bars : [{ key: "none", label: "—", color: "var(--text-muted)", points: [] }]}
            formatY={(y) => `レーン ${y.toFixed(0)}`} formatTick={(y) => (Number.isInteger(y) ? `L${y}` : "")} />
          <div className="two-col">
            <div className="table-wrap">
              <table className="data">
                <caption>ジョブの状態（queued → running → completed）</caption>
                <thead><tr><th scope="col" className="num">ジョブ</th><th scope="col" className="num">シナリオ</th><th scope="col">状態</th><th scope="col" className="num">レーン</th>
                  <th scope="col" className="num">開始〜終了（秒）</th><th scope="col" className="num">サーバーの計算（秒）</th><th scope="col">ワーカー</th><th scope="col">API応答</th></tr></thead>
                <tbody>{jobs.map((j) => (
                  <tr key={j.id}><th scope="row" className="num">JOB-{String(j.id).padStart(3, "0")}</th><td className="num">{j.scenarios[0].id}〜{j.scenarios[j.scenarios.length - 1].id}</td>
                    <td data-testid={`job-status-${j.id}`}>{j.status}{j.error ? `（${j.error}）` : ""}</td><td className="num">{j.lane == null ? "—" : `L${j.lane + 1}`}</td>
                    <td className="num">{j.start == null ? "—" : `${f(j.start / 1000, 2)}〜${j.end == null ? "" : f(j.end / 1000, 2)}`}</td>
                    <td className="num">{j.serverSeconds == null ? "—" : f(j.serverSeconds, 3)}</td><td>{j.worker ?? "—"}</td><td>{j.requestId ? <code>{j.requestId}</code> : "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>集約した結果：シナリオごとの現在価値（百万円）。届いたものから埋まる</caption>
                <thead><tr><th scope="col" className="num">スポット＼ボラ</th>{VOLS.map((v) => <th key={v} scope="col" className="num">{v}%</th>)}<th scope="col" className="num">平均</th></tr></thead>
                <tbody>{SPOTS.map((s, i) => (
                  <tr key={s}><th scope="row" className="num">{s}</th>
                    {VOLS.map((v, j) => { const r = results.get(i * VOLS.length + j + 1); return <td key={v} className="num">{r ? f(r.npv / 1e6, 2) : "…"}</td>; })}
                    <td className="num" data-testid={`spot-mean-${s}`}>{bySpot[i].mean == null ? "…" : f(bySpot[i].mean / 1e6, 2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
