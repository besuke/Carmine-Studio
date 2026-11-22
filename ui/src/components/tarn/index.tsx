import { useState } from "react";
import { fetchTarn, type TarnRequest } from "../../api/mbsPrdc";
import { LineChart } from "../LineChart";
import { CallState, Choice, Num, Status, Tag, Tile, f, metaLine, useCall, useMbsPrdcSummary } from "../p16Common";

// Chapter 14.4: a PRDC with a target redemption (TARN) and a knock-out. The state of each path is the cumulative coupon and
// whether the note is alive; the note ends on the date the cumulative coupon reaches the target, or the FX rate crosses the
// knock-out level. The numbers are rmql's three-factor Monte Carlo (FX and two Hull-White short rates).

const DATE = "2026-11-02";

export function TarnLive() {
  const [years, setYears] = useState(5);
  const [spot, setSpot] = useState(150);
  const [vol, setVol] = useState(11);
  const [leverage, setLeverage] = useState(80);
  const [subtraction, setSubtraction] = useState(78);
  const [cap, setCap] = useState(8);
  const [targetOn, setTargetOn] = useState(true);
  const [target, setTarget] = useState(15);
  const [capped, setCapped] = useState<"capped" | "full">("capped");
  const [makeWhole, setMakeWhole] = useState(true);
  const [koOn, setKoOn] = useState(true);
  const [ko, setKo] = useState(200);
  const [paths, setPaths] = useState(5000);
  const [steps, setSteps] = useState(12);
  const request: TarnRequest = {
    note: { years, spot, fxVolPct: vol, leveragePct: leverage, subtractionPct: subtraction, capPct: cap, fxBase: 150 },
    tarn: { targetPct: targetOn ? target : null, targetCoupon: capped, makeWhole: targetOn && makeWhole, knockOutLevel: koOn ? ko : null },
    mc: { paths, stepsPerYear: steps, seed: 7 },
  };
  const call = useCall(request, (r, o) => fetchTarn(r, o));
  const d = call.data;
  const work = paths * steps * years;
  return (
    <>
      <div className="controls" role="group" aria-label="TARN の入力" data-section="tarn">
        <Num label="年数" value={years} min={2} max={10} step={1} onChange={setYears} width="4em" />
        <Num label="為替の現物（円/ドル、基準 150）" value={spot} min={50} max={300} step={5} onChange={setSpot} width="5em" />
        <Num label="為替のボラティリティ（%）" value={vol} min={1} max={50} step={1} onChange={setVol} width="5em" />
        <Num label="レバレッジ（%）" value={leverage} min={0} max={500} step={5} onChange={setLeverage} width="5em" />
        <Num label="控除（%）" value={subtraction} min={0} max={500} step={1} onChange={setSubtraction} width="5em" />
        <Num label="クーポンのキャップ（%）" value={cap} min={0} max={50} step={0.5} onChange={setCap} width="5em" />
        <label><input type="checkbox" checked={targetOn} onChange={(e) => setTargetOn(e.target.checked)} aria-label="目標償還をつける" /> 目標償還（TARN）</label>
        {targetOn ? (
          <>
            <Num label="目標（累積クーポン、%）" value={target} min={0.5} max={100} step={1} onChange={setTarget} width="5em" />
            <Choice label="達した日のクーポン" value={capped} options={[["capped", "目標に届くまでに切る"], ["full", "全額払う"]]} onChange={setCapped} />
            <label><input type="checkbox" checked={makeWhole} onChange={(e) => setMakeWhole(e.target.checked)} aria-label="満期まで達しなければ不足分を払う" /> 不足分を最後に払う</label>
          </>
        ) : null}
        <label><input type="checkbox" checked={koOn} onChange={(e) => setKoOn(e.target.checked)} aria-label="ノックアウトをつける" /> ノックアウト</label>
        {koOn ? <Num label="ノックアウトの為替水準" value={ko} min={50} max={500} step={5} onChange={setKo} width="5em" /> : null}
        <Num label="経路数" value={paths} min={200} max={20000} step={1000} onChange={setPaths} width="6em" />
        <Num label="1 年のステップ数" value={steps} min={1} max={12} step={1} onChange={setSteps} width="4em" />
        <span className="controls-state muted">経路数 × ステップ × 年数 = {work.toLocaleString("ja-JP")}（上限 300,000）</span>
        <CallState call={call} />
      </div>
      <Status call={call} label={d ? `計算エンジン：${d.conventions.engine}（R、HTTP API）` : ""} />
      {d ? (
        <>
          <div className="tiles">
            <Tile emphasis label="価値（額面 100）" value={f(d.summary.value, 4)} testId="tarn-value" note={`標準誤差 ${f(d.summary.standard_error, 4)}`} />
            <Tile label="状態なし（TARN・ノックアウトなし）の価値" value={f(d.summary.plain_value, 4)} testId="tarn-plain" note={d.endings ? "同じ経路での価値" : `閉じた式 ${f(d.summary.analytic, 4)}`} />
            <Tile label="期待される期間（年）" value={f(d.summary.expected_life, 3)} testId="tarn-life" note="早く終わる確率で、満期より短くなる" />
          </div>
          <LineChart title="1 回のクーポン（額面 100 に対する %）：為替に対して、フロアとキャップで切り取る" origin={DATE} xMin={d.coupon_curve.fx[0]} xMax={d.coupon_curve.fx[20]}
            xTicks={[0.6, 0.8, 1, 1.2, 1.4].map((m) => { const x = m * 150; return { x, label: x.toFixed(0) }; })} xLabel="為替（円/ドル）" yLabel="クーポン"
            series={[{ key: "c", label: "クーポン", color: "var(--series-1)", points: d.coupon_curve.fx.map((x, i) => ({ x, y: d.coupon_curve.coupon[i], date: DATE })) }]}
            formatY={(y) => `${(100 * y).toFixed(2)}%`} formatTick={(y) => `${(100 * y).toFixed(0)}%`} zeroLine footer={<Tag id={d.response.request_id} />} />
          {d.endings ? (
            <div className="table-wrap">
              <table className="data">
                <caption>各日に終わる確率と、その日の後も生きている確率</caption>
                <thead><tr><th scope="col" className="num">年</th><th scope="col" className="num">目標に達して終わる</th><th scope="col" className="num">ノックアウトで終わる</th><th scope="col" className="num">生きている</th></tr></thead>
                <tbody>{d.endings.times.map((t, i) => <tr key={t}><td className="num">{t}</td><td className="num">{f(100 * d.endings!.target_probability[i], 2)}%</td><td className="num">{f(100 * d.endings!.knock_out_probability[i], 2)}%</td><td className="num">{f(100 * d.endings!.alive[i], 2)}%</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="muted">目標償還もノックアウトもないので、状態は持ちません（通常の PRDC と同じ評価です）。</p>}
          <p className="note">{d.conventions.target}。{d.conventions.model}。</p>
        </>
      ) : null}
    </>
  );
}

/** The saved distribution of the end (200,000 paths), the convergence and the dependence on the target. */
export function TarnDistribution() {
  const s = useMbsPrdcSummary();
  const d = s.data?.prdc_tarn_distribution;
  if (!d) return <Status call={s} label="" />;
  const e = d.endings;
  const ticks = e.times.map((x) => ({ x, label: `${x}年` }));
  return (
    <>
      <LineChart title="終わる確率（目標 15%、ノックアウト 200、20 万経路）" origin={DATE} xMin={0.5} xMax={5.5} xTicks={ticks} xLabel="終わる日" yLabel="確率" zeroLine
        series={[
          { key: "t", label: "目標に達して終わる", color: "var(--series-1)", points: e.times.map((x, i) => ({ x, y: e.target_probability[i], date: DATE })), dots: e.times.map((x, i) => ({ x, y: e.target_probability[i], date: DATE })) },
          { key: "k", label: "ノックアウトで終わる", color: "var(--series-2)", points: e.times.map((x, i) => ({ x, y: e.knock_out_probability[i], date: DATE })), dots: e.times.map((x, i) => ({ x, y: e.knock_out_probability[i], date: DATE })) },
        ]}
        formatY={(y) => `${(100 * y).toFixed(2)}%`} formatTick={(y) => `${(100 * y).toFixed(0)}%`} footer={<span className="muted">{metaLine(d.meta)}。満期まで生きている確率 {f(100 * e.alive_at_maturity, 2)}%</span>} />
      <div className="table-wrap">
        <table className="data">
          <caption>経路数と、価値の標準誤差（標準誤差は 1/√経路数 で減る）</caption>
          <thead><tr><th scope="col" className="num">経路数</th><th scope="col" className="num">価値</th><th scope="col" className="num">標準誤差</th><th scope="col" className="num">期待される期間（年）</th></tr></thead>
          <tbody>{d.convergence.map((r) => <tr key={r.paths}><td className="num">{r.paths.toLocaleString("ja-JP")}</td><td className="num">{f(r.value, 4)}</td><td className="num">{f(r.standard_error, 4)}</td><td className="num">{f(r.expected_life, 3)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>目標と、価値・期待される期間（2 万経路、ノックアウト 200、不足分を最後に払う）。目標なしの価値は {f(d.no_target.value, 4)}（閉じた式 {f(d.no_target.analytic, 4)}）</caption>
          <thead><tr><th scope="col" className="num">目標（%）</th><th scope="col" className="num">価値</th><th scope="col" className="num">標準誤差</th><th scope="col" className="num">期待される期間（年）</th></tr></thead>
          <tbody>{d.by_target.map((r) => <tr key={r.target_pct}><td className="num">{r.target_pct}</td><td className="num">{f(r.value, 4)}</td><td className="num">{f(r.standard_error, 4)}</td><td className="num">{f(r.expected_life, 3)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
