import { useMemo, useState, type ReactNode } from "react";
import type { CaseResult, CurvePoint, ScenarioResponse } from "../../api/types";
import { bp, df, full, pct, tenorJa, yen } from "../../format";
import { BUMP_BP, BUMP_TENOR, hasScenario, useScenario } from "../../state/ScenarioContext";
import { LineChart, type Series, type SeriesPoint } from "../LineChart";

const BASE_COLOR = "var(--series-1)";
const SCENARIO_COLOR = "var(--series-2)";
const BASE_LABEL = "初期";
const SCENARIO_LABEL = `変更後（${tenorJa(BUMP_TENOR)} ${BUMP_BP > 0 ? "+" : ""}${BUMP_BP} bp）`;

function Need({ children }: { children: (data: ScenarioResponse) => ReactNode }) {
  const { data, error } = useScenario();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}

const pointAt = (points: CurvePoint[], date: string) => points.find((p) => p.date === date);

/** The response the figure or table was drawn from; the same tag appears on every part that changes. */
export function ResponseTag({ data }: { data: ScenarioResponse }) {
  const bump = data.request.bumpBp;
  return (
    <span className="response-tag" data-request-id={data.response.request_id}>
      API応答 <code>{data.response.request_id}</code>（{bump === 0 ? "初期のみ" : `${tenorJa(data.request.bumpTenor)} ${bump > 0 ? "+" : ""}${bump} bp`}）
    </span>
  );
}

export function ApiStatus() {
  const { error, loading, retry } = useScenario();
  if (error) {
    return (
      <div className="banner error" role="alert">
        <strong>R APIに接続できませんでした。</strong> {error}
        <div className="banner-cmd">起動コマンド：<code>npm run api</code>（画面は <code>npm run dev</code>）</div>
        <button type="button" onClick={retry}>再試行</button>
      </div>
    );
  }
  if (loading) {
    return <p className="status" aria-live="polite">計算中…</p>;
  }
  return null;
}

export function ConditionsTable() {
  return (
    <Need>
      {(d) => {
        const c = d.conventions;
        const rows: [string, string][] = [
          ["評価日（カーブの参照日）", d.evaluation_date],
          ["指標・カレンダー", "TONA・日本の営業日"],
          ["カーブの時間軸", "Actual/365 Fixed"],
          ["OISの受渡日数", `${c.settlement_days}営業日（スポット日 ${d.swap_terms.effective_date}）`],
          ["支払頻度・支払ラグ", `年${c.payment_frequency}回・${c.payment_lag}営業日`],
          ["日程", "後ろ向き（Backward）、修正後続（Modified Following）"],
          ["固定レグの日数計算", "Actual/365 Fixed"],
          ["ピラー", "各OISの最終関連日（満期日）"],
          ["補間", "割引係数の対数の単調3次スプライン補間（Monotonic Log-Cubic）"],
          ["ブートストラップの精度", `割引係数で ${c.accuracy}`],
        ];
        return (
          <div className="table-wrap">
            <table className="kv">
              <caption>カーブ構築・スワップ評価の計算条件</caption>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

export function QuoteTable() {
  const { data } = useScenario();
  return (
    <Need>
      {(d) => {
        const show = hasScenario(data);
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>
                円TONA OISクォートと再現（評価日 {d.evaluation_date}、レートは %、<strong>サンプルデータ</strong>）
              </caption>
              <thead>
                <tr>
                  <th scope="col">年限</th>
                  <th scope="col" className="num">クォート</th>
                  {show && <th scope="col" className="num">変更後</th>}
                  <th scope="col">開始日</th>
                  <th scope="col">満期日（ピラー）</th>
                  <th scope="col" className="num">再現レート</th>
                  <th scope="col" className="num">再現誤差</th>
                </tr>
              </thead>
              <tbody>
                {d.quotes.map((q, i) => {
                  const inst = d.cases.base.instruments[i];
                  const changed = q.rate_scenario !== q.rate_base;
                  return (
                    <tr key={q.quote_id} className={show && changed ? "changed" : undefined}>
                      <th scope="row">{tenorJa(q.tenor)}</th>
                      <td className="num">{pct(q.rate_base, 2)}</td>
                      {show && <td className="num">{pct(q.rate_scenario, 2)}{changed ? " ◀" : ""}</td>}
                      <td>{inst.start_date}</td>
                      <td>{inst.pillar_date}</td>
                      <td className="num">{pct(inst.implied_rate, 8)}</td>
                      <td className="num">{inst.reproduction_error.toExponential(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">
              14本のサンプル気配値から7年を除いた13本を使用。「再現誤差」は |再現レート − クォート|（小数の金利）。
            </p>
          </div>
        );
      }}
    </Need>
  );
}

function RangeToggle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="range" role="group" aria-label="表示する期間" style={{ margin: 0 }}>
      {[10, 30].map((y) => (
        <button key={y} type="button" aria-pressed={value === y} onClick={() => onChange(y)}>
          {y}年先まで
        </button>
      ))}
    </div>
  );
}

const toPoints = (pts: CurvePoint[], pick: (p: CurvePoint) => number | null): SeriesPoint[] =>
  pts.flatMap((p) => {
    const y = pick(p);
    return y === null ? [] : [{ x: p.time, y, date: p.date }];
  });

function pillarMarkers(d: ScenarioResponse) {
  const want = ["4Y", "5Y", "8Y"];
  const m = d.cases.base.instruments
    .filter((i) => want.includes(i.tenor))
    .map((i) => ({ x: d.cases.base.nodes.find((n) => n.date === i.pillar_date)!.time, label: `${tenorJa(i.tenor)}ピラー` }));
  m.push({ x: pointAt(d.cases.base.curve_points, d.swap_terms.termination_date)!.time, label: "7年OIS満期" });
  return m;
}

const pickDf = (p: CurvePoint) => p.discount;
const pickZeroPct = (p: CurvePoint) => (p.zero_continuous === null ? null : p.zero_continuous * 100);
const pickFwdPct = (p: CurvePoint) => p.forward_1d_simple * 100;

function overlay(d: ScenarioResponse, pick: (p: CurvePoint) => number | null, baseDots?: SeriesPoint[], scenDots?: SeriesPoint[]): Series[] {
  const s: Series[] = [{ key: "base", label: BASE_LABEL, color: BASE_COLOR, points: toPoints(d.cases.base.curve_points, pick), dots: baseDots }];
  if (hasScenario(d)) {
    s.push({ key: "scenario", label: SCENARIO_LABEL, color: SCENARIO_COLOR, points: toPoints(d.cases.scenario.curve_points, pick), dashed: true, dots: scenDots });
  }
  return s;
}

/** Display transform only: the difference of the two curves in the same response. */
function difference(d: ScenarioResponse, pick: (p: CurvePoint) => number | null, scale: number): Series[] {
  const b = d.cases.base.curve_points;
  const pts: SeriesPoint[] = [];
  d.cases.scenario.curve_points.forEach((p, i) => {
    const yb = pick(b[i]);
    const ys = pick(p);
    if (yb !== null && ys !== null) {
      pts.push({ x: p.time, y: (ys - yb) * scale, date: p.date });
    }
  });
  return [{ key: "diff", label: "変更後 − 初期", color: SCENARIO_COLOR, points: pts }];
}

export function SwapLegTable() {
  return (
    <Need>
      {(d) => {
        const show = hasScenario(d);
        const b = d.cases.base.swap;
        const s = d.cases.scenario.swap;
        const legs = [["TONAレグ（受け）", "overnight_leg_npv"], ["固定レグ（払い）", "fixed_leg_npv"], ["合計（PV）", "npv"]] as const;
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>7年OIS レグ別の現在価値（円。固定レグは支払なので負）　<ResponseTag data={d} /></caption>
              <thead>
                <tr>
                  <th scope="col">レグ</th>
                  <th scope="col" className="num">初期</th>
                  {show && <th scope="col" className="num">変更後</th>}
                  {show && <th scope="col" className="num">差</th>}
                </tr>
              </thead>
              <tbody>
                {legs.map(([label, k]) => (
                  <tr key={k}>
                    <th scope="row">{label}</th>
                    <td className="num">{yen(b[k])}</td>
                    {show && <td className="num">{yen(s[k])}</td>}
                    {show && <td className="num">{yen(s[k] - b[k], true)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/**
 * OISスワップ画面のメインダッシュボード：
 * - 上段：入力（5年クォート＋1bp、リセット、横軸範囲）と主要な評価結果（7年OISの初期PV・変更後PV・PV差）
 * - 中段：割引係数・ゼロ金利・フォワード金利の3グラフ横並び（同じ横軸範囲・高さで比較）
 */
export function OisDashboard() {
  const [range, setRange] = useState(30);
  const { bumpBp, setBumpBp, loading, data } = useScenario();
  const active = bumpBp !== 0;

  const series = useMemo(() => {
    if (!data) return null;
    const baseDots = data.cases.base.nodes.flatMap((n) => (n.zero_continuous === null ? [] : [{ x: n.time, y: n.zero_continuous * 100, date: n.date }]));
    const scenDots = data.cases.scenario.nodes.flatMap((n) => (n.zero_continuous === null ? [] : [{ x: n.time, y: n.zero_continuous * 100, date: n.date }]));
    return {
      df: overlay(data, pickDf),
      zero: overlay(data, pickZeroPct, baseDots, hasScenario(data) ? scenDots : undefined),
      fwd: overlay(data, pickFwdPct),
    };
  }, [data]);

  return (
    <Need>
      {(d) => {
        const show = hasScenario(d);
        const t = d.swap_terms;
        const b = d.cases.base.swap;
        const s = d.cases.scenario.swap;
        const markers = pillarMarkers(d);
        const footer = <ResponseTag data={d} />;

        return (
          <section className="ois-dashboard" aria-label="OISスワップ評価ダッシュボード">
            {/* 上段：入力と主要な評価結果 */}
            <div className="dashboard-top">
              <div className="dashboard-card">
                <div className="dashboard-card-title">
                  <span>入力・表示設定（基準日 {d.evaluation_date}）</span>
                  <span className="controls-state" aria-live="polite">
                    {loading ? "再計算中…" : <ResponseTag data={d} />}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                  <div role="group" aria-label="クォートの操作" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-secondary)" }}>シナリオ:</span>
                    <button type="button" className="primary" onClick={() => setBumpBp(BUMP_BP)} disabled={loading || active}>
                      {tenorJa(BUMP_TENOR)}クォート＋{BUMP_BP} bp
                    </button>
                    <button type="button" onClick={() => setBumpBp(0)} disabled={loading || !active}>
                      リセット
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-secondary)" }}>横軸の範囲（3グラフ共通）:</span>
                    <RangeToggle value={range} onChange={setRange} />
                  </div>
                  <p className="note" style={{ margin: 0 }}>
                    割引係数の対数を単調3次スプラインで補間し、1暦日フォワードを算出する。
                  </p>
                </div>
              </div>

              <div className="dashboard-card">
                <div className="dashboard-card-title">
                  <span>7年OIS（固定払い・TONA受け）主要評価結果</span>
                  <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>
                    想定元本 {yen(t.notional)}（100億円）｜期間 {t.effective_date} 〜 {t.termination_date}｜固定レート {pct(t.fixed_rate, 6)}（<code>{full(t.fixed_rate)}</code>）
                  </span>
                </div>
                <div className="tiles" style={{ margin: 0 }}>
                  <div className="tile">
                    <div className="tile-label">初期PV</div>
                    <div className="tile-value" data-testid="pv-base">{yen(b.npv)}</div>
                    <div className="tile-note">初期7年パーレート適用のため数値誤差内でゼロ</div>
                  </div>
                  <div className="tile">
                    <div className="tile-label">変更後PV</div>
                    <div className="tile-value" data-testid="pv-scenario">{show ? yen(s.npv) : "—"}</div>
                    <div className="tile-note">{show ? `変更後7年パーレート ${pct(s.par_rate, 6)}` : "「5年クォート＋1 bp」で計算"}</div>
                  </div>
                  <div className="tile emphasis">
                    <div className="tile-label">PV差（変更後 − 初期）</div>
                    <div className="tile-value" data-testid="pv-change">{show ? yen(d.pv_change, true) : "—"}</div>
                    <div className="tile-note">
                      {show ? <>丸め前 <code data-testid="pv-change-full">{d.pv_change.toFixed(4)}</code> 円（パー変化 {bp(d.par_change_bp)}）</> : "固定レート据え置きでの時価変動"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 中段：割引係数・ゼロ金利・フォワード金利の3グラフ横並び */}
            <div className="chart-grid-3">
              <LineChart
                title="割引係数カーブ"
                series={series!.df}
                origin={d.evaluation_date}
                xMax={range}
                height={245}
                legend
                markers={markers}
                yLabel="割引係数"
                formatY={(y) => df(y, 10)}
                formatTick={(y) => y.toFixed(2)}
                footer={footer}
              />
              <LineChart
                title="連続複利ゼロ金利カーブ（点はピラー）"
                series={series!.zero}
                origin={d.evaluation_date}
                xMax={range}
                height={245}
                legend
                markers={markers}
                yLabel="ゼロ金利（%）"
                formatY={(y) => `${y.toFixed(4)}%`}
                formatTick={(y) => y.toFixed(1)}
                footer={footer}
              />
              <LineChart
                title="フォワード金利カーブ（1暦日の単利）"
                series={series!.fwd}
                origin={d.evaluation_date}
                xMax={range}
                height={245}
                legend
                markers={markers}
                yLabel="フォワード金利（%）"
                formatY={(y) => `${y.toFixed(4)}%`}
                formatTick={(y) => y.toFixed(1)}
                footer={footer}
              />
            </div>

            {show && (
              <div className="chart-grid-3">
                <LineChart
                  title="割引係数の差（変更後 − 初期、×10⁻⁴）"
                  series={difference(d, pickDf, 1e4)}
                  origin={d.evaluation_date}
                  xMax={range}
                  height={175}
                  markers={markers}
                  zeroLine
                  yLabel="差（×10⁻⁴）"
                  formatY={(y) => y.toFixed(4)}
                  formatTick={(y) => y.toFixed(1)}
                  footer={footer}
                />
                <LineChart
                  title="ゼロ金利の差（変更後 − 初期、bp）"
                  series={difference(d, pickZeroPct, 100)}
                  origin={d.evaluation_date}
                  xMax={range}
                  height={175}
                  markers={markers}
                  zeroLine
                  yLabel="差（bp）"
                  formatY={(y) => `${y.toFixed(3)} bp`}
                  formatTick={(y) => y.toFixed(1)}
                  footer={footer}
                />
                <LineChart
                  title="フォワード金利の差（変更後 − 初期、bp）"
                  series={difference(d, pickFwdPct, 100)}
                  origin={d.evaluation_date}
                  xMax={range}
                  height={175}
                  markers={markers}
                  zeroLine
                  yLabel="差（bp）"
                  formatY={(y) => `${y.toFixed(3)} bp`}
                  formatTick={(y) => y.toFixed(0)}
                  footer={footer}
                />
              </div>
            )}
          </section>
        );
      }}
    </Need>
  );
}

export function BaseCurveCharts() {
  return <OisDashboard />;
}

export function ScenarioControls() {
  return null;
}

export function ScenarioCharts() {
  return null;
}

export function SwapPanel() {
  return <SwapLegTable />;
}

export function SegmentTable() {
  return (
    <Need>
      {(d) => {
        const show = hasScenario(d);
        const b = d.cases.base.segments;
        const s = d.cases.scenario.segments;
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>ピラー間のフォワード金利（連続複利、Actual/365 Fixed）　<ResponseTag data={d} /></caption>
              <thead>
                <tr>
                  <th scope="col">区間</th>
                  <th scope="col" className="num">初期</th>
                  {show && <th scope="col" className="num">変更後</th>}
                  {show && <th scope="col" className="num">差</th>}
                </tr>
              </thead>
              <tbody>
                {b.map((seg, i) => {
                  const diff = (s[i].forward_continuous - seg.forward_continuous) * 1e4;
                  return (
                    <tr key={seg.start_date} className={show && Math.abs(diff) > 1e-6 ? "changed" : undefined}>
                      <th scope="row">{seg.start_date} 〜 {seg.end_date}</th>
                      <td className="num">{pct(seg.forward_continuous)}</td>
                      {show && <td className="num">{pct(s[i].forward_continuous)}</td>}
                      {show && <td className="num">{bp(diff, 3)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

export function SevenYearMechanism() {
  return (
    <Need>
      {(d) => {
        const show = hasScenario(d);
        const pillar = (tenor: string) => d.cases.base.instruments.find((i) => i.tenor === tenor)!.pillar_date;
        const rows: [string, string][] = [
          ["4年のピラー", pillar("4Y")],
          ["5年のピラー", pillar("5Y")],
          ["7年OISの満期（ピラーではない）", d.swap_terms.termination_date],
          ["8年のピラー", pillar("8Y")],
        ];
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>7年の割引係数を決める節点　<ResponseTag data={d} /></caption>
              <thead>
                <tr>
                  <th scope="col">日付</th>
                  <th scope="col" className="num">初期</th>
                  {show && <th scope="col" className="num">変更後</th>}
                  {show && <th scope="col" className="num">差（×10⁻⁴）</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, date]) => {
                  const pb = pointAt(d.cases.base.curve_points, date)!;
                  const ps = pointAt(d.cases.scenario.curve_points, date)!;
                  return (
                    <tr key={label}>
                      <th scope="row">{label}<br /><span className="muted">{date}</span></th>
                      <td className="num">{df(pb.discount)}</td>
                      {show && <td className="num">{df(ps.discount)}</td>}
                      {show && <td className="num">{((ps.discount - pb.discount) * 1e4).toFixed(4)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

function legFlows(c: CaseResult, leg: "fixed" | "overnight") {
  return c.swap.cashflows.filter((f) => f.leg === leg);
}

export function CashflowTable() {
  return (
    <Need>
      {(d) => {
        const show = hasScenario(d);
        const fixedB = legFlows(d.cases.base, "fixed");
        const onB = legFlows(d.cases.base, "overnight");
        const fixedS = legFlows(d.cases.scenario, "fixed");
        const onS = legFlows(d.cases.scenario, "overnight");
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>7年OISの支払日程と割引係数（金額は円、符号なし）　<ResponseTag data={d} /></caption>
              <thead>
                <tr>
                  <th scope="col">計算期間</th>
                  <th scope="col">支払日</th>
                  <th scope="col" className="num">固定額</th>
                  <th scope="col" className="num">TONA額（初期）</th>
                  {show && <th scope="col" className="num">TONA額（変更後）</th>}
                  <th scope="col" className="num">割引係数（初期）</th>
                  {show && <th scope="col" className="num">割引係数（変更後）</th>}
                </tr>
              </thead>
              <tbody>
                {fixedB.map((f, i) => (
                  <tr key={f.payment_date}>
                    <td>{f.accrual_start} 〜 {f.accrual_end}</td>
                    <td>{f.payment_date}</td>
                    <td className="num">{yen(f.amount)}</td>
                    <td className="num">{yen(onB[i].amount)}</td>
                    {show && <td className="num">{yen(onS[i].amount)}</td>}
                    <td className="num">{df(f.discount)}</td>
                    {show && <td className="num">{df(fixedS[i].discount)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}
