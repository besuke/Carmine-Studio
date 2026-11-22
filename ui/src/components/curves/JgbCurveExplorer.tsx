import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchJgbCurves, type JgbCurvesResponse, type MarketCurveDataset } from "../../api/jgbCurves";
import { LineChart, type Series, type SeriesPoint } from "../LineChart";

// Month-end JGB and US Treasury yield curves with a YYYYMM slider and play/pause.
// For each market, two linked charts are shown side by side:
// 1. Cross-sectional yield curve across maturities at the selected month (with observed nodes and interpolated curve)
// 2. Time-series trajectories of key maturities revealed from 1990 up to the selected month (like jgb_yield_time_series_animation.gif)

const PLAY_MS = 100;
const JGB_TICKS = [1, 2, 5, 10, 20, 30, 40];
const UST_TICKS = [1, 2, 5, 10, 20, 30];
const YEAR_TICKS = [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];

const JGB_TS_TENORS: { tenor: number; label: string; color: string }[] = [
  { tenor: 1, label: "1年", color: "#4ea8ff" },
  { tenor: 2, label: "2年", color: "#22d3ee" },
  { tenor: 5, label: "5年", color: "#00d26a" },
  { tenor: 10, label: "10年", color: "#ff5c7a" },
  { tenor: 20, label: "20年", color: "#ff9f1c" },
  { tenor: 30, label: "30年", color: "#b794f6" },
  { tenor: 40, label: "40年", color: "#a6b0bf" },
];

const UST_TS_TENORS: { tenor: number; label: string; color: string }[] = [
  { tenor: 1, label: "1年", color: "#4ea8ff" },
  { tenor: 2, label: "2年", color: "#22d3ee" },
  { tenor: 5, label: "5年", color: "#00d26a" },
  { tenor: 10, label: "10年", color: "#ff5c7a" },
  { tenor: 20, label: "20年", color: "#ff9f1c" },
  { tenor: 30, label: "30年", color: "#b794f6" },
];

const ym = (m: string) => `${m.slice(0, 4)}年${m.slice(4)}月`;
const monthToYear = (m: string) => Number(m.slice(0, 4)) + (Number(m.slice(4, 6)) - 0.5) / 12;
const t3 = (y: number) => `${(Math.trunc(y * 1000) / 1000).toFixed(3)}%`;

type MarketView = "both" | "jgb" | "ust";

function MarketPanel({
  titlePrefix,
  dataset,
  index,
  curveTicks,
  tsTenors,
  requestId,
}: {
  titlePrefix: string;
  dataset: MarketCurveDataset;
  index: number;
  curveTicks: number[];
  tsTenors: { tenor: number; label: string; color: string }[];
  requestId: string;
}) {
  const safeIdx = Math.min(index, dataset.months.length - 1);
  const month = dataset.months[safeIdx];

  const curveSeries = useMemo<Series[]>(() => {
    if (!month) return [];
    const curve: SeriesPoint[] = month.curve_yield_pct.map((y, k) => {
      const t = dataset.curve_step * (k + 1);
      return { x: t, y, date: `${t}年` };
    });
    const nodes: SeriesPoint[] = month.node_tenor.map((t, k) => ({ x: t, y: month.node_yield_pct[k], date: `${t}年` }));
    return [
      { key: "curve", label: "推計イールドカーブ", color: "var(--series-1)", points: curve },
      { key: "nodes", label: "観測利回り", color: "var(--series-2)", points: [], dots: nodes },
    ];
  }, [dataset, month]);

  const timeSeries = useMemo<Series[]>(() => {
    const slice = dataset.months.slice(0, safeIdx + 1);
    return tsTenors.map(({ tenor, label, color }) => {
      const pts: SeriesPoint[] = [];
      for (const m of slice) {
        const k = m.node_tenor.indexOf(tenor);
        if (k >= 0) {
          pts.push({ x: monthToYear(m.month), y: m.node_yield_pct[k], date: `${ym(m.month)}（${label}）` });
        }
      }
      const last = pts.length > 0 ? [pts[pts.length - 1]] : undefined;
      return {
        key: `ts-${tenor}`,
        label,
        color,
        points: pts,
        dots: last,
      };
    });
  }, [dataset.months, safeIdx, tsTenors]);

  if (!month) return null;
  const footer = <span className="response-tag" data-request-id={requestId}>API応答 <code>{requestId}</code></span>;

  return (
    <div className="two-col" style={{ marginTop: "0.75rem" }}>
      <LineChart
        title={`${titlePrefix}：イールドカーブ（年限方向、${ym(month.month)}末・観測日 ${month.date}）`}
        origin="2026-01-01"
        xMin={0}
        xMax={dataset.axis.x_max}
        xTicks={curveTicks.map((x) => ({ x, label: `${x}` }))}
        xLabel="残存年数（年）"
        yLabel="利回り（%）"
        yRange={[dataset.axis.y_min, dataset.axis.y_max]}
        height={275}
        zeroLine
        series={curveSeries}
        formatY={t3}
        formatTick={(y) => y.toFixed(1)}
        footer={footer}
      />
      <LineChart
        title={`${titlePrefix}：年限別利回りの時系列推移（時間方向、1990年1月〜${ym(month.month)}）`}
        origin="1990-01-01"
        xMin={1990}
        xMax={2027}
        xTicks={YEAR_TICKS.map((y) => ({ x: y, label: `${y}` }))}
        xLabel="観測年"
        yLabel="利回り（%）"
        yRange={[dataset.axis.y_min, dataset.axis.y_max]}
        height={275}
        zeroLine
        series={timeSeries}
        markers={[{ x: monthToYear(month.month), label: ym(month.month) }]}
        formatY={t3}
        formatTick={(y) => y.toFixed(1)}
        footer={footer}
      />
    </div>
  );
}

export function JgbCurveExplorer() {
  const [data, setData] = useState<JgbCurvesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<MarketView>("both");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const c = new AbortController();
    fetchJgbCurves({ signal: c.signal })
      .then((d) => {
        setData(d);
        setIndex(d.months.length - 1);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiError ? e.message : String(e));
      });
    return () => c.abort();
  }, []);

  // play: one month per tick from the current month; stop at the last month
  useEffect(() => {
    if (!playing || !data) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => {
        if (i >= data.months.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_MS);
    return () => window.clearInterval(timer.current);
  }, [playing, data]);

  const month = data?.months[index];

  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  if (!data || !month) return <p className="muted">月別のカーブを計算中…</p>;

  const togglePlay = () => {
    if (!playing && index >= data.months.length - 1) setIndex(0);
    setPlaying((p) => !p);
  };

  return (
    <div className="jgb-explorer">
      <div className="controls month-player" role="group" aria-label="表示する年月と市場">
        <button type="button" className="primary" onClick={togglePlay} aria-pressed={playing} data-testid="jgb-play">
          {playing ? "一時停止" : "再生"}
        </button>
        <input
          type="range"
          min={0}
          max={data.months.length - 1}
          step={1}
          value={index}
          aria-label="年月"
          aria-valuetext={ym(month.month)}
          data-testid="jgb-slider"
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
        <output className="month-label" data-testid="jgb-month" aria-live={playing ? "off" : "polite"}>
          {month.month}（{ym(month.month)}）
        </output>
        <div className="range" role="group" aria-label="表示する市場" style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={view === "both"} onClick={() => setView("both")}>
            日米両方
          </button>
          <button type="button" aria-pressed={view === "jgb"} onClick={() => setView("jgb")}>
            日本国債（JGB）
          </button>
          <button type="button" aria-pressed={view === "ust"} onClick={() => setView("ust")}>
            米国債（UST）
          </button>
        </div>
      </div>

      {(view === "both" || view === "jgb") && (
        <MarketPanel
          titlePrefix="日本国債（JGB）"
          dataset={data}
          index={index}
          curveTicks={JGB_TICKS}
          tsTenors={JGB_TS_TENORS}
          requestId={data.response.request_id}
        />
      )}

      {(view === "both" || view === "ust") && data.ust && (
        <MarketPanel
          titlePrefix="米国債（US Treasury）"
          dataset={data.ust}
          index={index}
          curveTicks={UST_TICKS}
          tsTenors={UST_TS_TENORS}
          requestId={data.response.request_id}
        />
      )}

      <div className="dashboard-card" style={{ marginTop: "0.85rem" }}>
        <div className="dashboard-card-title">
          <span>データソースと計算方法（{ym(data.months[0].month)}〜{ym(data.months[data.months.length - 1].month)}、{data.months.length} か月）</span>
          <span className="muted">{data.conventions.engine}</span>
        </div>
        <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.88rem", lineHeight: 1.65 }}>
          <li>
            <strong>日本国債（JGB）データソース</strong>：財務省「
            <a href="https://www.mof.go.jp/jgbs/reference/interest_rate/index.htm" target="_blank" rel="noopener noreferrer">
              国債金利情報（Interest Rate Historical Data）
            </a>
            」（ヒストリカルCSV：
            <a href="https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv" target="_blank" rel="noopener noreferrer">
              <code>jgbcme_all.csv</code>
            </a>
            ）の各月の最終観測日の半年複利利回り（1年〜40年）。
          </li>
          <li>
            <strong>米国債（US Treasury）データソース</strong>：米連邦準備制度理事会（FRB）H.15 Selected Interest Rates ／ セントルイス連銀{" "}
            <a href="https://fred.stlouisfed.org/categories/115" target="_blank" rel="noopener noreferrer">
              FRED（Federal Reserve Economic Data：Treasury Constant Maturity）
            </a>
            （系列：
            <a href="https://fred.stlouisfed.org/series/DGS1" target="_blank" rel="noopener noreferrer"><code>DGS1</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS2" target="_blank" rel="noopener noreferrer"><code>DGS2</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS3" target="_blank" rel="noopener noreferrer"><code>DGS3</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS5" target="_blank" rel="noopener noreferrer"><code>DGS5</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS7" target="_blank" rel="noopener noreferrer"><code>DGS7</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS10" target="_blank" rel="noopener noreferrer"><code>DGS10</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS20" target="_blank" rel="noopener noreferrer"><code>DGS20</code></a>,{" "}
            <a href="https://fred.stlouisfed.org/series/DGS30" target="_blank" rel="noopener noreferrer"><code>DGS30</code></a>
            ）の各月の最終観測日の利回り（1年〜30年）。
          </li>
          <li>
            <strong>カーブ構築と時系列表示</strong>：{data.conventions.curve}。左図は選択した月末時点の年限方向のイールドカーブ、右図は1990年1月から選択した月末までの年限別利回りの時間方向の推移を連動して描きます。
          </li>
        </ul>
      </div>
    </div>
  );
}
