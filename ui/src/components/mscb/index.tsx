import { useState } from "react";
import { fetchConvertible, fetchMscb, type MscbRequest } from "../../api/p16";
import { LineChart } from "../LineChart";
import { CallState, Choice, Num, Status, Tag, Tile, f, metaLine, sign, useCall, useSummary } from "../p16Common";

// Chapters 13.4 and 13.5: the MSCB. 13.4: the conversion price reset at conversion (the conversion value is capped, and above
// lower / ratio the holder converts at once). 13.5: the conversion price carried between reset dates (a grid of prices, or the
// scaled lattice in S / K). The page shows what rmql returns; the grid with Greeks and the closed-form tables are saved.

const sci = (x: number) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));

/** 13.4: the conversion value of a reset price, and whether the holder converts at once. */
export function ResetShape() {
  const [alpha, setAlpha] = useState(0.9);
  const [lower, setLower] = useState(80);
  const [capOn, setCapOn] = useState(false);
  const [upper, setUpper] = useState(140);
  const [spot, setSpot] = useState(100);
  const request = {
    bond: { remainingYears: 5, couponPct: 2, redemption: 100 },
    conversion: { kind: "reset" as const, priceRatio: alpha, lowerPrice: lower, upperPrice: capOn ? upper : null },
    market: { spot, ratePct: 3, dividendYieldPct: 1, volatilityPct: 25, creditSpreadPct: 2 }, steps: 200,
  };
  const call = useCall(request, (r, o) => fetchConvertible(r, o));
  const d = call.data;
  const threshold = lower / alpha;
  const ticks = d ? [0.4, 0.8, 1.2, 1.6].map((m) => ({ x: Math.round(m * spot), label: String(Math.round(m * spot)) })) : [];
  return (
    <>
      <div className="controls" role="group" aria-label="転換時にリセットする MSCB の入力" data-section="mscb-reset">
        <label>価格の比 α{" "}
          <input type="range" min={0.5} max={1.2} step={0.01} value={alpha} aria-label="価格の比 α" onChange={(e) => setAlpha(Number(e.target.value))} />
          {" "}<strong>{f(alpha, 2)}</strong>（転換価額 = α × 株価）
        </label>
        <Num label="転換価額の下限" value={lower} min={1} max={500} step={5} onChange={setLower} width="5em" />
        <label><input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} aria-label="転換価額に上限をつける" /> 上限</label>
        {capOn ? <Num label="転換価額の上限" value={Math.max(upper, lower)} min={lower} max={1000} step={5} onChange={setUpper} width="5em" /> : null}
        <Num label="現物" value={spot} min={10} max={500} step={5} onChange={setSpot} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label={d ? "残存 5 年・クーポン 2%・アメリカン・信用スプレッド 2%" : ""} />
      {d ? (
        <>
          <div className="tiles">
            <Tile emphasis label="価値" value={f(d.values.value, 4)} testId="reset-value" note={`頭打ち F/α = ${f(100 / alpha, 4)}`} />
            <Tile label="即時に転換するか" value={d.immediate_conversion ? "はい" : "いいえ"} testId="reset-immediate"
              note={alpha < 1 ? `株価が 下限 / α = ${f(threshold, 2)} 以上なら、いつでも F/α で転換できる` : "α が 1 以上では、この性質は出ません"} />
          </div>
          <LineChart
            title="転換価値（額面 100 あたり）：下限/α で頭打ち（F/α）、上限があれば 上限/α から再び増える" origin="2026-11-02" xMin={ticks[0]?.x ?? 0} xMax={Math.round(1.8 * spot)} xTicks={ticks} xLabel="株価" yLabel="転換価値"
            series={[{ key: "cv", label: "転換価値", color: "var(--series-1)", points: d.conversion_value.spots.map((x, i) => ({ x, y: d.conversion_value.values[i], date: "2026-11-02" })) }]}
            formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<Tag id={d.response.request_id} />}
          />
          <p className="note">転換価値は F·max(S/上限, min(S/下限, 1/α)) である。株価が下限/α までは S/下限 に比例して増え、そこで F/α に頭打ちになる（上限があれば、上限/α を超えると S/上限 で再び増える）。α が 1 未満のとき、株価が 下限/α 以上なら、アメリカン型の保有者は、いつでも F/α で転換できる。その価値は、満期までの待つ価値ではなく F/α そのものになる。</p>
        </>
      ) : null}
    </>
  );
}

/** 13.4: the saved table of the closed form against the lattice. */
export function ResetClosedForm() {
  const s = useSummary();
  const d = s.data?.mscb_reset_closed_form;
  if (!d) return <Status call={s} label="" />;
  const steps = d.closed_form_table[0].steps;
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>ヨーロピアン・ゼロクーポン・信用スプレッドなし・コールなしの閉じた式と、木の相対誤差　<span className="muted">{metaLine(d.meta)}</span></caption>
        <thead>
          <tr><th scope="col" className="num">α</th><th scope="col" className="num">下限</th><th scope="col" className="num">上限</th><th scope="col" className="num">閉じた式</th>
            {steps.map((n) => <th key={n} scope="col" className="num">{n} 段の相対誤差</th>)}</tr>
        </thead>
        <tbody>
          {d.closed_form_table.map((r, i) => (
            <tr key={i}><td className="num">{f(r.alpha, 2)}</td><td className="num">{r.lower_price}</td><td className="num">{r.upper_price ?? "なし"}</td><td className="num">{f(r.closed_form, 4)}</td>
              {r.relative_error.map((e, j) => <td key={j} className="num">{sci(e)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 13.5: a conversion price carried between resets. */
export function CarriedLive() {
  const [resets, setResets] = useState(4);
  const [rule, setRule] = useState<"downward_only" | "both">("downward_only");
  const [method, setMethod] = useState<"scaled" | "grid">("scaled");
  const [scenario, setScenario] = useState<"down" | "flat" | "up">("down");
  const [alpha, setAlpha] = useState(0.9);
  const [spot, setSpot] = useState(85);
  const [nodes, setNodes] = useState(40);
  const [steps, setSteps] = useState(200);
  const request: MscbRequest = {
    bond: { remainingYears: 5, couponPct: 2, redemption: 100 }, exercise: "american",
    callabilities: [{ years: 3, kind: "call", price: 108, priceType: "dirty" }],
    conversion: { initialPrice: 100, priceRatio: alpha }, resetYears: Array.from({ length: resets }, (_, i) => i + 1), rule, method, priceNodes: nodes, greeks: method === "scaled", scenario,
    market: { spot, ratePct: 3, dividendYieldPct: 1, volatilityPct: 25, creditSpreadPct: 2 }, steps,
  };
  const call = useCall(request, (r, o) => fetchMscb(r, o));
  const d = call.data;
  const sc = d?.scenario;
  return (
    <>
      <div className="controls" role="group" aria-label="転換価額を持ち越す MSCB の入力" data-section="mscb-carried">
        <Choice label="リセット" value={String(resets)} options={[["0", "なし"], ["1", "1 年後"], ["2", "毎年（2 回）"], ["4", "毎年（4 回）"]]} onChange={(v) => setResets(Number(v))} />
        <Choice label="規則" value={rule} options={[["downward_only", "下方修正だけ（downward_only）"], ["both", "上下とも（both）"]]} onChange={setRule} />
        <Choice label="方法" value={method} options={[["scaled", "縮約（S/K の 1 次元）"], ["grid", "転換価額の格子（2 次元）"]]} onChange={setMethod} />
        <Choice label="株価のシナリオ" value={scenario} options={[["down", "下落（年 −15%）"], ["flat", "横ばい"], ["up", "上昇（年 +15%）"]]} onChange={setScenario} />
        <label>価格の比 α{" "}<input type="range" min={0.5} max={1.1} step={0.01} value={alpha} aria-label="価格の比 α" onChange={(e) => setAlpha(Number(e.target.value))} />{" "}<strong>{f(alpha, 2)}</strong></label>
        <Num label="現物（最初の転換価額は 100）" value={spot} min={10} max={300} step={5} onChange={setSpot} width="5em" />
        {method === "grid" ? <Num label="転換価額の点数" value={nodes} min={2} max={80} step={10} onChange={setNodes} width="4em" /> : null}
        <Num label="木の段数" value={steps} min={2} max={400} step={50} onChange={setSteps} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label={d ? "アメリカン、残存 5 年、クーポン 2%、3 年後にコール 108、信用スプレッド 2%" : ""} />
      {d ? (
        <>
          <div className="tiles">
            <Tile emphasis label="価値" value={f(d.values.value, 4)} testId="carried-value" note={d.conventions.method} />
            {method === "scaled" ? <Tile label="デルタ" value={f(d.values.delta, 4)} note="縮約では、グリークスも求まる" /> : <Tile label="グリークス" value="事前計算" note="転換価額の格子のグリークスは 1 秒を超えるので、下の事前計算の表を見る" />}
          </div>
          {sc ? (
            <LineChart
              title={`転換価額の履歴（${scenario === "down" ? "株価が下落" : scenario === "up" ? "株価が上昇" : "株価が横ばい"}するシナリオ。リセット日ごとに規則を適用）`} origin="2026-11-02" xMin={0} xMax={5}
              xTicks={[0, 1, 2, 3, 4, 5].map((x) => ({ x, label: `${x}年` }))} xLabel="リセット日" yLabel="価格"
              series={[
                { key: "k", label: "転換価額", color: "var(--series-1)", points: [{ x: 0, y: 100, date: "2026-11-02" }, ...sc.reset_years.map((x, i) => ({ x, y: sc.conversion_price[i], date: "2026-11-02" }))], dots: sc.reset_years.map((x, i) => ({ x, y: sc.conversion_price[i], date: "2026-11-02" })) },
                { key: "s", label: "株価（年 " + (sc.drift_per_year * 100).toFixed(0) + "% のシナリオ）", color: "var(--text-muted)", dashed: true, points: [{ x: 0, y: spot, date: "2026-11-02" }, ...sc.reset_years.map((x, i) => ({ x, y: sc.share_price[i], date: "2026-11-02" }))] },
              ]}
              formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<Tag id={d.response.request_id} />}
            />
          ) : <p className="muted">リセットがないので、転換価額は 100 のままである（固定比率の転換社債と同じ値になる）。</p>}
          <p className="note">{d.conventions.reset}。シナリオは、株価が一定の率で動いたとして、各リセット日の転換価額を規則の式で求めた教育用の例である（価値の計算には使っていない）。</p>
        </>
      ) : null}
    </>
  );
}

/** 13.5: the saved grid convergence, the closed form of `both`, the times and the Greeks of a grid. */
export function CarriedGrid() {
  const s = useSummary();
  const g = s.data?.mscb_carried_grid;
  if (!g) return <Status call={s} label="" />;
  const c = g.convergence;
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <caption>転換価額の格子の点数と、縮約（{f(c.scaled, 4)}）との差（{300} 段）　<span className="muted">{metaLine(g.meta)}</span></caption>
          <thead><tr><th scope="col" className="num">点数</th><th scope="col" className="num">格子の価値</th><th scope="col" className="num">縮約との相対差</th></tr></thead>
          <tbody>{c.price_nodes.map((n, i) => <tr key={n}><td className="num">{n}</td><td className="num">{f(c.grid[i], 4)}</td><td className="num">{sci(c.relative_difference[i])}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>規則 both、リセット 1 回、ヨーロピアンの閉じた式（{f(g.closed_form_both.closed_form, 4)}）との相対誤差</caption>
          <thead><tr><th scope="col">方法</th><th scope="col" className="num">価値</th><th scope="col" className="num">相対誤差</th></tr></thead>
          <tbody>
            <tr><th scope="row">縮約（{g.closed_form_both.scaled_steps} 段）</th><td className="num">{f(g.closed_form_both.scaled, 4)}</td><td className="num">{sci(g.closed_form_both.scaled_relative_error)}</td></tr>
            <tr><th scope="row">格子（{g.closed_form_both.grid_price_nodes} 点・{g.closed_form_both.grid_steps} 段）</th><td className="num">{f(g.closed_form_both.grid, 4)}</td><td className="num">{sci(g.closed_form_both.grid_relative_error)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>計算の時間（秒、この PC の実測）：縮約は 1 次元、格子は点数ぶんの 2 次元</caption>
          <thead><tr><th scope="col" className="num">段数</th><th scope="col">グリークス</th><th scope="col" className="num">縮約</th><th scope="col" className="num">格子 40 点</th><th scope="col" className="num">格子 80 点</th></tr></thead>
          <tbody>{g.timing.map((t, i) => <tr key={i}><td className="num">{t.steps}</td><td>{t.greeks ? "あり" : "なし"}</td><td className="num">{f(t.scaled_seconds, 3)}</td><td className="num">{f(t.grid_40_seconds, 2)}</td><td className="num">{f(t.grid_80_seconds, 2)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>グリークス：格子（{g.greeks.price_nodes} 点・{g.greeks.steps} 段）と縮約</caption>
          <thead><tr><th scope="col">項目</th><th scope="col" className="num">格子</th><th scope="col" className="num">縮約</th></tr></thead>
          <tbody>{(["value", "delta", "gamma", "vega", "rho", "dividend_rho", "credit_spread_sensitivity"] as const).map((k) => <tr key={k}><th scope="row">{k}</th><td className="num">{sign(g.greeks.grid[k], 4)}</td><td className="num">{sign(g.greeks.scaled[k], 4)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption data-testid="vega-convergence">ベガ（1.00 あたり）：自動微分と中心差分　<span className="muted">{metaLine(g.meta)}</span></caption>
          <thead>
            <tr><th scope="col">方法</th><th scope="col" className="num">段数</th><th scope="col" className="num">点数</th><th scope="col" className="num">自動微分</th><th scope="col" className="num">差分（幅 1e-5）</th><th scope="col" className="num">差分（幅 0.01）</th><th scope="col" className="num">差分（幅 0.02）</th></tr>
          </thead>
          <tbody>{g.vega_convergence.map((r, i) => <tr key={i}><th scope="row">{r.method === "scaled" ? "縮約" : "格子"}</th><td className="num">{r.steps}</td><td className="num">{r.method === "scaled" ? "—" : r.price_nodes}</td><td className="num">{f(r.vega_ad, 2)}</td><td className="num">{f(r.fd_micro, 2)}</td><td className="num">{f(r.fd_wide_0_01, 2)}</td><td className="num">{f(r.fd_wide_0_02, 2)}</td></tr>)}</tbody>
        </table>
        <p className="note">ベガは、離散木の局所の傾きで、段数で動く（縮約の 200〜3200 段で 53、91、78、76、75）。幅の広い差分は約 82〜85 に落ち着く。格子の自動微分は転換価額の格子を固定して微分するので、格子を作り直す差分とは一致しない。</p>
      </div>
    </>
  );
}
