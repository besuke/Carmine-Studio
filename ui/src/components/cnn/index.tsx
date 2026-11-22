import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import {
  fetchCnnForecast, fetchCnnSummary,
  type CnnBondInputs, type CnnForecastResponse, type CnnModel, type CnnPeriod, type CnnScenario, type CnnSummaryResponse,
} from "../../api/cnn";
import { LineChart } from "../LineChart";

// Components of chapter 11.4: a 1D-CNN forecast of next month's JGB curve, against ridge regression and the random
// walk, and what each forecast does to a bond's value. The page only shows what the API returns: the training was
// done offline, and the bond is valued by rmql on the server.

const DEFAULT_BOND: CnnBondInputs = { remainingYears: 10, couponPct: 1, faceAmount: 100 };
const MODEL_LABEL: Record<CnnModel, string> = { random_walk: "ランダムウォーク（変化 0 bp）", ridge: "リッジ回帰", cnn: "1D-CNN" };
const MODEL_COLOR: Record<CnnModel, string> = { random_walk: "var(--text-muted)", ridge: "var(--series-2)", cnn: "var(--series-1)" };
const PERIOD_LABEL: Record<CnnPeriod, string> = { all: "全期間", first_half: "前半", second_half: "後半", since_2022: "2022 年以降" };

interface CState {
  summary: CnnSummaryResponse | null;
  forecast: CnnForecastResponse | null;
  loading: boolean;
  error: string | null;
  index: number; // the chosen origin month, an index into summary.months.origin
  bond: CnnBondInputs;
  setIndex: (i: number) => void;
  setBond: (p: Partial<CnnBondInputs>) => void;
}
const Ctx = createContext<CState | null>(null);

const monthOf = (iso: string) => iso.slice(0, 7).replace("-", "");

export function CnnProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<CnnSummaryResponse | null>(null);
  const [forecast, setForecast] = useState<CnnForecastResponse | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [bond, setBondState] = useState(DEFAULT_BOND);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const c = new AbortController();
    fetchCnnSummary({ signal: c.signal })
      .then((d) => {
        setSummary(d);
        // start at the most recent origin month
        setIndex((i) => i ?? d.months.origin.length - 1);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiError ? e.message : String(e));
        setLoading(false);
      });
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (!summary || index === null) return;
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchCnnForecast({ month: monthOf(summary.months.origin[index]), bond }, { signal: c.signal })
        .then((d) => { setForecast(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [summary, index, bond]);

  return (
    <Ctx.Provider value={{ summary, forecast, loading, error, index: index ?? 0, bond, setIndex, setBond: (p) => setBondState((b) => ({ ...b, ...p })) }}>
      {children}
    </Ctx.Provider>
  );
}

function useC(): CState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useC must be used inside CnnProvider");
  return s;
}

const Tag = ({ id }: { id: string }) => <span className="response-tag" data-request-id={id}>API応答 <code>{id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const sign = (x: number, n: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(n)}`;

export function CnnStatus() {
  const { error, loading, summary } = useC();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : summary ? "学習はオフラインで実施済み" : ""}</p>;
}

/** The month to forecast from, and the bond. */
export function CnnControls() {
  const { summary, forecast, index, setIndex, bond, setBond, loading, error } = useC();
  if (!summary) return null;
  const origins = summary.months.origin;
  return (
    <div className="controls" role="group" aria-label="予測の条件" data-section="cnn">
      <label>予測の起点（月末）{" "}
        <input type="range" min={0} max={origins.length - 1} step={1} value={index} aria-label="予測の起点の年月" onChange={(e) => setIndex(Number(e.target.value))} />
        {" "}<strong data-testid="cnn-month">{origins[index].slice(0, 7)}</strong>
        {" → "}<span>{summary.months.target[index].slice(0, 7)}</span>
      </label>
      <label>残存年限{" "}
        <select value={bond.remainingYears} aria-label="債券の残存年限" onChange={(e) => setBond({ remainingYears: Number(e.target.value) })}>
          {[2, 3, 5, 7, 10, 15, 20].map((n) => <option key={n} value={n}>{n} 年</option>)}
        </select>
      </label>
      <label>クーポン（%）{" "}
        <input type="number" min={0} max={10} step={0.1} value={bond.couponPct} aria-label="債券のクーポン（%）" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBond({ couponPct: v }); }} />
      </label>
      <label>額面{" "}
        <input type="number" min={1} max={1e9} step={100} value={bond.faceAmount} aria-label="債券の額面" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBond({ faceAmount: v }); }} />
      </label>
      <span className="controls-state">{loading ? "サーバーで計算中…" : error ? <span className="error-text">{error}</span> : forecast ? <Tag id={forecast.response.request_id} /> : null}</span>
    </div>
  );
}

function Need({ children }: { children: (d: CnnForecastResponse, s: CnnSummaryResponse) => ReactNode }) {
  const { forecast, summary, error } = useC();
  if (forecast && summary) return <>{children(forecast, summary)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}

/** The forecast curves and the realized one, with the four nodes' changes. */
export function ForecastCurves() {
  return (
    <Need>
      {(d) => {
        const series = (key: string, label: string, color: string, y: number[], date: string, dashed = false) => ({
          key, label, color, dashed, points: d.curves.years.map((x, i) => ({ x, y: y[i], date })),
        });
        const xs = d.curves.years;
        const all = [...d.curves.current, ...Object.values(d.curves.scenario).flat()];
        const lo = Math.min(...all), hi = Math.max(...all);
        return (
          <>
            <LineChart
              title={`${d.dates.origin} の翌月（${d.dates.next_month}）のカーブ：予測と実績（ゼロ金利、年複利）`} origin={d.dates.next_month} xMin={0} xMax={xs[xs.length - 1]}
              xTicks={[0, 2, 5, 10, 15, 20].map((x) => ({ x, label: `${x}年` }))} xLabel="年限" yLabel="ゼロ金利（%）"
              series={[
                series("cur", "当月末の実績", "var(--text-muted)", d.curves.current, d.dates.origin, true),
                series("act", "翌月の実績", "var(--text)", d.curves.scenario.actual, d.dates.next_month),
                series("cnn", "1D-CNN の予測", MODEL_COLOR.cnn, d.curves.scenario.cnn, d.dates.next_month),
                series("rdg", "リッジ回帰の予測", MODEL_COLOR.ridge, d.curves.scenario.ridge, d.dates.next_month),
              ]}
              yRange={[Math.floor(lo * 10) / 10 - 0.05, Math.ceil(hi * 10) / 10 + 0.05]}
              formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(2)}%`} footer={<Tag id={d.response.request_id} />}
            />
            <div className="table-wrap">
              <table className="data">
                <caption>4 つの年限の利回りの変化（bp）　<Tag id={d.response.request_id} /></caption>
                <thead>
                  <tr><th scope="col">モデル</th>{d.nodes.tenor.map((t) => <th key={t} scope="col" className="num">{t}年</th>)}</tr>
                </thead>
                <tbody>
                  {(["actual", "cnn", "ridge", "random_walk"] as CnnScenario[]).map((k) => (
                    <tr key={k}>
                      <th scope="row">{k === "actual" ? "実績" : MODEL_LABEL[k]}</th>
                      {d.nodes.change_bp[k].map((c, i) => <td key={i} className="num">{sign(c, 1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** The bond valued by rmql on each scenario's curve, and its profit and loss. */
export function ValuationTable() {
  return (
    <Need>
      {(d) => (
        <>
          <div className="tiles">
            <div className="tile emphasis">
              <div className="tile-label">当月末の債券の価値（{d.dates.origin}）</div>
              <div className="tile-value" data-testid="cnn-current-npv">{f(d.current_value.npv, 4)}</div>
              <div className="tile-note">額面 {d.inputs.bond.faceAmount.toLocaleString("ja-JP")}、クーポン {f(d.inputs.bond.couponPct, 2)}%、残存 {d.inputs.bond.remainingYears} 年</div>
            </div>
            <div className="tile">
              <div className="tile-label">翌月の実績の損益</div>
              <div className="tile-value" data-testid="cnn-actual-pnl">{sign(d.valuation[0].pnl, 4)}</div>
              <div className="tile-note">{d.dates.next_month} のカーブでの価値 − 当月末の価値</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <caption>債券の価値と損益　<Tag id={d.response.request_id} /></caption>
              <thead>
                <tr>
                  <th scope="col">シナリオ</th><th scope="col" className="num">翌月末の価値</th><th scope="col" className="num">単価</th>
                  <th scope="col" className="num">損益</th><th scope="col" className="num">実績の損益との差</th>
                </tr>
              </thead>
              <tbody>
                {d.valuation.map((v) => (
                  <tr key={v.scenario}>
                    <th scope="row">{v.label}</th>
                    <td className="num">{f(v.npv, 4)}</td><td className="num">{f(v.clean_price, 4)}</td>
                    <td className="num" data-testid={`cnn-pnl-${v.scenario}`}>{sign(v.pnl, 4)}</td>
                    <td className="num">{v.scenario === "actual" ? "—" : sign(v.pnl_error, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{d.conventions.bond}。{d.conventions.pnl}。{d.conventions.curve}。</p>
        </>
      )}
    </Need>
  );
}

/** RMSE and MAE of the three models, by period. */
export function MetricsTable() {
  const { summary } = useC();
  const [period, setPeriod] = useState<CnnPeriod>("all");
  if (!summary) return <p className="muted">計算中…</p>;
  const rows = summary.metrics[period];
  const tenors = [...summary.settings.tenors.map((t) => `${t}Y`), "all"];
  const get = (model: CnnModel, tenor: string) => rows.find((r) => r.model === model && r.tenor === tenor)!;
  const models: CnnModel[] = ["random_walk", "ridge", "cnn"];
  return (
    <>
      <div className="controls" role="group" aria-label="評価の期間">
        <label>期間{" "}
          <select value={period} aria-label="評価の期間" onChange={(e) => setPeriod(e.target.value as CnnPeriod)}>
            {(Object.keys(PERIOD_LABEL) as CnnPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
          </select>
        </label>
        <span className="controls-state"><Tag id={summary.response.request_id} /></span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>翌月の変化幅の予測誤差（bp、{get("cnn", "all").months} か月のアウトオブサンプル。各セルは RMSE / MAE）</caption>
          <thead>
            <tr><th scope="col">モデル</th>{tenors.map((t) => <th key={t} scope="col" className="num">{t === "all" ? "4 年限の合計" : t.replace("Y", "年")}</th>)}</tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m}>
                <th scope="row">{MODEL_LABEL[m]}</th>
                {tenors.map((t) => <td key={t} className="num" data-testid={`cnn-metric-${m}-${t}`}>{f(get(m, t).rmse, 2)} / {f(get(m, t).mae, 2)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        二乗誤差が同じ月のランダムウォークより小さかった月の割合（全期間）：1D-CNN {f(100 * summary.share_better_than_random_walk.cnn, 1)}%、リッジ回帰 {f(100 * summary.share_better_than_random_walk.ridge, 1)}%。
      </p>
    </>
  );
}

/** The rolling error of the three models over time. */
export function ErrorSeries() {
  const { summary } = useC();
  if (!summary) return null;
  const origins = summary.months.origin;
  const t0 = Date.parse(`${origins[0]}T00:00:00Z`);
  const years = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - t0) / 86_400_000 / 365;
  const series = (["random_walk", "ridge", "cnn"] as CnnModel[]).map((m) => ({
    key: m, label: MODEL_LABEL[m], color: MODEL_COLOR[m], dashed: m === "random_walk",
    points: origins.flatMap((_o, i) => (summary.rolling_rmse[m][i] === null ? [] : [{ x: years(summary.months.target[i]), y: summary.rolling_rmse[m][i] as number, date: summary.months.target[i] }])),
  }));
  return (
    <LineChart
      title={`過去 ${summary.rolling_rmse_window} か月の RMSE（bp、4 年限の合計）`} origin={origins[0]} xMax={years(origins[origins.length - 1]) + 1}
      yLabel="RMSE（bp）" series={series} formatY={(y) => `${y.toFixed(2)} bp`} formatTick={(y) => y.toFixed(0)} footer={<Tag id={summary.response.request_id} />}
    />
  );
}

/** The learned kernels of the last fit: one table per filter, tenor by lag, shaded by sign and size. */
export function KernelView() {
  const { summary } = useC();
  if (!summary) return null;
  const { filters, kernel: width, tenors } = summary.settings;
  const w = summary.kernels.last;
  const max = Math.max(...w.flat().map(Math.abs));
  const shade = (v: number) => `color-mix(in srgb, ${v >= 0 ? "var(--series-1)" : "var(--series-2)"} ${Math.round((100 * Math.abs(v)) / max)}%, transparent)`;
  return (
    <>
      <div className="two-col">
        {Array.from({ length: filters }, (_, fi) => (
          <div key={fi} className="table-wrap">
            <table className="data" data-testid={`cnn-kernel-${fi}`}>
              <caption>フィルター {fi + 1}（行は年限、列はカーネルの位置：1 が最も古く {width} が最も新しい）</caption>
              <thead><tr><th scope="col">年限</th>{Array.from({ length: width }, (_, k) => <th key={k} scope="col" className="num">{k + 1}</th>)}</tr></thead>
              <tbody>
                {tenors.map((t, c) => (
                  <tr key={t}>
                    <th scope="row">{t}年</th>
                    {Array.from({ length: width }, (_, k) => {
                      const v = w[fi][c * width + k];
                      return <td key={k} className="num" style={{ background: shade(v) }}>{sign(v, 3)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="note">
        {summary.kernels.origin_month[summary.kernels.origin_month.length - 1]} 時点で学習した第 1 シードのカーネル（標準化した入力に対する重み。正と負は色を分けて、濃いほど絶対値が大きい）。
        学習は {summary.settings.retrain_every} か月ごとにやり直し、予測は {summary.settings.seeds} つのシードの平均です。
      </p>
    </>
  );
}

/** The settings and the gradient check, for the record. */
export function CnnSettings() {
  const { summary } = useC();
  if (!summary) return null;
  const s = summary.settings;
  const g = summary.gradient_check;
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>実験の設定と数値勾配チェック　<Tag id={summary.response.request_id} /></caption>
        <tbody>
          <tr><th scope="row">データ</th><td>{summary.data.months} か月（{summary.data.first.slice(0, 7)}〜{summary.data.last.slice(0, 7)}）、2・5・10・20 年の月末利回り</td></tr>
          <tr><th scope="row">入力と出力</th><td>直近 {s.lookback} か月の変化（4 チャネル × {s.lookback}）→ 翌月の 4 年限の変化（bp）</td></tr>
          <tr><th scope="row">ネットワーク</th><td>1D 畳み込み（フィルター {s.filters}、幅 {s.kernel}）→ ReLU → 全結合。L2 {s.l2}、Adam（学習率 {s.learning_rate}）</td></tr>
          <tr><th scope="row">評価</th><td>ウォークフォワード：最初の {s.min_train} サンプルのあとの各月を起点とし、{s.retrain_every} か月ごとに学習し直す。{s.seeds} シードの平均</td></tr>
          <tr><th scope="row">数値勾配チェック</th><td>カーネル {g.kernel.toExponential(1)}、畳み込みのバイアス {g.conv_bias.toExponential(1)}、全結合の重み {g.dense_weight.toExponential(1)}、全結合のバイアス {g.dense_bias.toExponential(1)}、入力 {g.input.toExponential(1)}（最大の差 ÷ 最大の勾配成分）</td></tr>
        </tbody>
      </table>
    </div>
  );
}
