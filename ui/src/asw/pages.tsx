import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { fetchAswDetail, fetchAswList, type AswConditions, type AswDetailResponse, type AswListResponse, type ResponseStamp } from "../api/asw";
import { href } from "../book/router";
import { df, pct } from "../format";
import { FlowChart, type FlowBar } from "../components/FlowChart";
import { LineChart } from "../components/LineChart";
import { UsageGuide } from "../components/UsageGuide";

// OIS asset swap offer sheet: the list of offers and the detail of one offer.
// Every number is computed by the R API with rmql; the page only lays it out.

function useApi<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    load(c.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ data: null, error: e instanceof ApiError ? e.message : String(e), loading: false });
      });
    return () => c.abort();
  }, [key, attempt]); // load is rebuilt on each render; key identifies what it loads
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

function ApiProblem({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="banner error" role="alert">
      <strong>R APIの応答を受け取れませんでした。</strong> {error}
      <div className="banner-cmd">起動コマンド：<code>npm run api</code></div>
      <button type="button" onClick={retry}>再試行</button>
    </div>
  );
}

const Stamp = ({ r }: { r: ResponseStamp }) => (
  <span className="response-tag" data-request-id={r.request_id}>API応答 <code>{r.request_id}</code></span>
);

const bpText = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)} bp`;
const per100 = (v: number, digits = 6) => v.toFixed(digits);

function ConditionsBlock({ c }: { c: AswConditions }) {
  const rows: [string, ReactNode][] = [
    ["評価日（オファー日・市場日）", c.valuation_date],
    ["ASW の定義", c.asw_definition],
    ["ASW の翌日物レグ", `年${c.asw_overnight_leg.payment_frequency}回払い・支払ラグ${c.asw_overnight_leg.payment_lag}（${c.asw_overnight_leg.note}）`],
    ["OISカーブ", `${c.curve.interpolation === "monotonic_log_cubic" ? "割引係数の単調対数3次補間（MonotonicLogCubic）" : c.curve.interpolation}、OIS 年${c.curve.payment_frequency}回払い・支払ラグ${c.curve.payment_lag}、外挿${c.curve.extrapolation ? "あり" : "なし"}`],
    ["銘柄属性の結合", `ISIN で結合。${c.attribute_policy}`],
    ["データ", c.data_note],
    ["計算エンジン", `${c.engine}（R、HTTP API）`],
  ];
  return (
    <table className="kv">
      <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  );
}

const STATUS_LABEL = { computed: "計算済み", unsupported: "対象外", failed: "計算できない" } as const;

export function AswListPage() {
  const { data, error, loading, retry } = useApi<AswListResponse>((signal) => fetchAswList({ signal }), "list");
  return (
    <article className="prose wide">
      <h1>OISアセットスワップ・オファーシート</h1>
      <p>
        債券のオファー（クリーン価格）から、発行通貨の OIS に対するアセットスワップ・スプレッド（ASW）を計算する。行を選ぶと、使ったカーブ、価格の換算、
        債券とスワップのキャッシュフロー、ASW の計算条件を確かめられる。仕様は Coral-Book の <code>docs/asw_offer_sheet_spec.qmd</code>、
        データと規約は Curie の A1 オファーシートのデモ（<strong>架空のデータ</strong>）である。
      </p>
      <UsageGuide
        lead="入力欄はなく、オファーの行を選んで詳細を開く。オファーは12件（円債 JPY-01〜06、外債 ISO-01〜06）で、単価はオファーのクリーン価格（額面100あたり）である。"
        steps={[
          { text: <><b>オファー一覧</b> の <b>ID</b>（例：JPY-01）か <b>銘柄</b> をクリックして、詳細を開く。</>, to: "オファー一覧" },
          { text: <><b>ASW</b>（発行通貨の OIS に対するスプレッド）と <b>円の比較</b> の列を比べる。円債は JGB 対比、外債は円換算 ASW が出る。</>, to: "オファー一覧" },
          { text: <>JPY-06（変動利付債）と ISO-06（コーラブル債）は未対応で、行の下に理由が出る。</>, to: "オファー一覧" },
        ]}
      />
      {error && <ApiProblem error={error} retry={retry} />}
      {loading && !data && <p className="muted">R APIで計算中…</p>}
      {data && (
        <>
          <h2>計算条件</h2>
          <ConditionsBlock c={data.conditions} />
          <h2>オファー一覧</h2>
          <div className="table-wrap">
            <table className="data offers">
              <caption>
                {data.offers.length}件（計算済み {data.offers.filter((o) => o.status === "computed").length}件）。単価は額面100あたりのクリーン価格。　<Stamp r={data.response} />
              </caption>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">銘柄</th>
                  <th scope="col">通貨</th>
                  <th scope="col">満期</th>
                  <th scope="col" className="num">クーポン</th>
                  <th scope="col" className="num">単価</th>
                  <th scope="col" className="num">数量（額面）</th>
                  <th scope="col" className="num">ASW<br /><span className="muted">発行通貨のOIS</span></th>
                  <th scope="col" className="num">円の比較<br /><span className="muted">円債：JGB対比／外債：円換算ASW</span></th>
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => [
                  <tr key={o.offer_id} className={o.status === "computed" ? undefined : "not-computed"}>
                    <th scope="row"><a href={href(`/asw/${o.offer_id}`)}>{o.offer_id}</a></th>
                    <td className="wrap">
                      <a href={href(`/asw/${o.offer_id}`)}>{o.security_name}</a>
                      <br /><span className="muted">{o.ISIN}・{o.broker}・受渡 {o.settlement_date}</span>
                    </td>
                    <td>{o.currency}</td>
                    <td>{o.maturity_date ?? "—"}</td>
                    <td className="num">{o.coupon_rate === null ? "—" : pct(o.coupon_rate, 2)}</td>
                    <td className="num">{o.offer_price.toFixed(2)}</td>
                    <td className="num">{new Intl.NumberFormat("ja-JP").format(o.offer_size)}</td>
                    <td className="num" data-testid={`asw-${o.offer_id}`}>
                      {o.fair_spread_bp === null ? <span className={`status status-${o.status}`}>{STATUS_LABEL[o.status]}</span> : bpText(o.fair_spread_bp)}
                    </td>
                    <td className="num" data-testid={`yen-asw-${o.offer_id}`}>
                      {o.yen_asw_bp !== null ? bpText(o.yen_asw_bp) : o.jgb_spread_bp !== null ? <>JGB {bpText(o.jgb_spread_bp)}</> : "—"}
                    </td>
                  </tr>,
                  o.reason || o.yen_reason ? (
                    <tr key={`${o.offer_id}-reason`} className="not-computed reason-row">
                      <td colSpan={9}><span className="reason">理由：{o.reason || `円換算ASW：${o.yen_reason}`}</span></td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
          </div>
          <p className="note">
            ASW は発行通貨の OIS（JPY は TONA、USD は SOFR、EUR は €STR）に対するスプレッドで、正の値は翌日物レグに上乗せして受け取る金利である。
            円債の「JGB対比」は（複利利回り − 同じ償還日に補間したJGB複利利回り）× 100 bp。円換算 ASW は、外貨建て債券を円担保の通貨スワップで円にヘッジしたときの、円TONAR に対するスプレッドである（円担保・元本一定、満期のベーシス1点で校正した簡易モデル）。
            発行通貨の ASW とベーシスの単純な和とは一致しない。数量は額面金額（各通貨の単位）である。
          </p>
        </>
      )}
    </article>
  );
}

export function AswDetailPage({ offerId }: { offerId: string }) {
  const { data, error, loading, retry } = useApi<AswDetailResponse>((signal) => fetchAswDetail(offerId, { signal }), offerId);
  return (
    <article className="prose wide">
      <p><a href={href("/asw")}>← オファー一覧</a></p>
      {error && <ApiProblem error={error} retry={retry} />}
      {loading && !data && <p className="muted">R APIで計算中…</p>}
      {data && <Detail d={data} />}
    </article>
  );
}

function Detail({ d }: { d: AswDetailResponse }) {
  const o = d.offer;
  const a = d.attributes;
  const title = (a?.security_name as string) ?? (o.offer_security_name as string);
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">{o.ISIN}　{o.offer_id}　<Stamp r={d.response} /></p>
      {d.status !== "computed" ? (
        <div className="banner" role="status"><strong>{STATUS_LABEL[d.status]}</strong>　{d.reason}</div>
      ) : (
        <div className="tiles">
          <div className="tile emphasis">
            <div className="tile-label">ASWスプレッド（{d.detail!.curve.index} に対して）</div>
            <div className="tile-value" data-testid="asw-detail">{bpText(d.summary!.fair_spread_bp, 4)}</div>
            <div className="tile-note">丸め前 <code>{d.summary!.fair_spread_bp}</code> bp</div>
          </div>
          {d.yen && (
            <div className="tile emphasis">
              <div className="tile-label">円換算ASW（円TONAR に対して）</div>
              <div className="tile-value" data-testid="yen-asw-detail">{d.yen.yen_asw_bp === null ? "—" : bpText(d.yen.yen_asw_bp, 4)}</div>
              <div className="tile-note">{d.yen.status === "computed" ? <>丸め前 <code>{d.yen.yen_asw_bp}</code> bp（6. を参照）</> : d.yen.reason}</div>
            </div>
          )}
          <div className="tile">
            <div className="tile-label">ダーティ価格（額面100）</div>
            <div className="tile-value">{d.summary!.dirty_price.toFixed(6)}</div>
            <div className="tile-note">クリーン {Number(o.offer_price).toFixed(2)} ＋ 経過利子 {d.summary!.accrued.toFixed(6)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">スワップの期間</div>
            <div className="tile-value tile-small">{d.summary!.effective_date} 〜 {d.summary!.maturity_date}</div>
            <div className="tile-note">開始日 = 債券の受渡日</div>
          </div>
        </div>
      )}

      {d.status === "computed" && (
        <UsageGuide
          lead="入力欄は、キャッシュフロー表示の切り替えだけである。オファーの単価（クリーン価格）から、ダーティ価格、キャッシュフロー、ASW スプレッドの順に画面を下へ読む。"
          steps={[
            { text: <>上のタイルで <b>ASWスプレッド</b> と <b>ダーティ価格（額面100）</b> を確認する。<b>円換算ASW</b> のタイルは外債だけに出る。</> },
            { text: <><b>2. 適用したカーブ</b> で使ったカーブを、<b>3. 価格の入力と換算</b> でクリーンからダーティへの換算を見る。</>, to: "2. 適用したカーブ", label: "2." },
            { text: <><b>利息だけ</b> と <b>元本・償還を含む</b> を切り替えて、債券とスワップのキャッシュフローを見る。</>, to: "4. 債券とスワップのキャッシュフロー", label: "4." },
            { text: <><b>5. ASWスプレッドの計算</b> で、NPV がゼロになるスプレッドを確認する。</>, to: "5. ASWスプレッドの計算", label: "5." },
            ...(d.yen?.detail ? [{ text: <>外債は <b>6. 円換算ASW</b> で、FXスポット、ベーシス、ヘッジ後のキャッシュフローを見る。</>, to: "6. 円換算ASW（通貨ベーシスを反映）", label: "6." }] : []),
            ...(d.jgb ? [{ text: <>円債は <b>6. JGBスプレッド</b> で、補間した JGB 利回りとの差を見る。</>, to: "6. JGBスプレッド", label: "6." }] : []),
          ]}
        />
      )}
      <h2>1. オファーと銘柄属性</h2>
      <OfferAndAttributes d={d} />
      <h2>計算条件</h2>
      <ConditionsBlock c={d.conditions} />
      {d.detail && <Computed d={d} />}
      {d.yen?.detail && <YenSection d={d} />}
      {d.jgb && <JgbSection d={d} />}
      {d.yen && d.yen.status !== "computed" && (
        <>
          <h2>6. 円換算ASW</h2>
          <div className="banner" role="status"><strong>計算できない</strong>　{d.yen.reason}</div>
        </>
      )}
    </>
  );
}

function YenSection({ d }: { d: AswDetailResponse }) {
  const y = d.yen!;
  const x = y.detail!;
  const c = x.components;
  const k = x.checks;
  const ccy = d.attributes?.currency as string;
  const origin = d.conditions.valuation_date;
  const footer = <Stamp r={d.response} />;
  const yearsOf = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000 / 365;
  const xMax = Math.ceil(Math.max(x.basis.points[x.basis.points.length - 1].time, x.basis.maturity_time) + 0.25);
  const yen = (v: number, digits = 4) => `${v.toFixed(digits)} 円`;
  const sumRows: [string, string, number][] = [
    ["B_j", "ヘッジ後の債券キャッシュフローの円の現在価値（支払）", c.hedged_bond_pv],
    ["Q_j", "円TONARレグ＋満期元本の現在価値（受取、FXスポット換算）", c.yen_base_leg_pv],
    ["U_j", "受渡日の価格調整の円の現在価値（開始日の FX で換算）", c.upfront_pv],
    ["A_j", "円のスプレッド・アニュイティ", c.annuity],
  ];
  return (
    <>
      <h2>6. 円換算ASW（通貨ベーシスを反映）</h2>
      <p>
        {ccy} 建ての債券を、円担保の通貨スワップで円にヘッジしたときの、円TONAR に対するフェア・スプレッドである。通貨スワップは「{x.basis.terms.pay_leg} を支払い、
        {x.basis.terms.receive_leg} を受け取る」形で、元本は一定、開始日と満期日に交換する。満期に対応するベーシス1点で、外貨割引の一定スプレッド z を校正する。
        CCS の期間構造全体を校正したモデルではありません。
      </p>
      <table className="kv">
        <caption>前提（{d.conditions.engine}）</caption>
        <tbody>
          {Object.entries(d.conditions.yen_asw).map(([key, v]) => (
            <tr key={key}><th scope="row">{{ collateral: "担保・元本", ccs: "通貨スワップ", calibration: "校正", fx: "FXスポット", not_included: "含まないもの" }[key] ?? key}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <h3>FXスポットとベーシス</h3>
      <table className="kv">
        <tbody>
          <tr><th scope="row">FXスポット X（{ccy}JPY）</th><td>{x.fx.spot}（{x.fx.convention}、受渡日 {x.fx.spot_date} = ASW 開始日、取得時刻 {x.fx.quote_time}）</td></tr>
          <tr><th scope="row">ベーシス b（満期 {x.basis.maturity_date} に補間）</th><td><span className="num-cell">{x.basis.interpolated_bp.toFixed(6)} bp</span></td></tr>
          <tr><th scope="row">補間の方法</th><td>{x.basis.method}</td></tr>
          <tr><th scope="row">使った気配の条件</th><td>{Object.values(x.basis.terms).join("・")}（元本リセット型の気配は使わない）</td></tr>
        </tbody>
      </table>
      <LineChart title={`${ccy}JPY ベーシス（円レッグに加算、点は同じ満期の気配の平均）`} origin={origin} xMax={xMax} yLabel="ベーシス（bp）"
        series={[{ key: "basis", label: "補間（自然3次スプライン）", color: "var(--series-1)",
          points: x.basis.curve.map((p) => ({ x: p.time, y: p.basis_bp, date: p.date })),
          dots: x.basis.points.map((p) => ({ x: p.time, y: p.basis_bp, date: p.maturity_date })) }]}
        formatY={(v) => `${v.toFixed(3)} bp`} formatTick={(v) => v.toFixed(0)} markers={[{ x: x.basis.maturity_time, label: "債券満期" }]} footer={footer} />
      <div className="table-wrap">
        <table className="data">
          <caption>ベーシス気配（同じ満期の平均）</caption>
          <thead><tr><th scope="col">満期</th><th scope="col" className="num">年数</th><th scope="col" className="num">ベーシス（bp）</th><th scope="col" className="num">気配の数</th></tr></thead>
          <tbody>{x.basis.points.map((p) => <tr key={p.maturity_date}><td>{p.maturity_date}</td><td className="num">{p.time.toFixed(4)}</td><td className="num">{p.basis_bp.toFixed(2)}</td><td className="num">{p.n_quotes}</td></tr>)}</tbody>
        </table>
      </div>

      <h3>FXフォワードとヘッジ後の債券キャッシュフロー</h3>
      <p className="formula">F(S,T) = X · [D_f(T)/D_f(S)] / [D_j(T)/D_j(S)] · exp(−z·τ(S,T))　　z = {c.z_bp.toFixed(6)} bp</p>
      <FlowChart title={`債券キャッシュフローの円換算額の現在価値（${ccy} 額面100あたり、利息だけ）`} origin={origin} xMax={Math.ceil(x.basis.maturity_time + 0.25)}
        bars={x.hedged_cashflows.filter((f) => f.kind !== "redemption").map((f) => ({ date: f.payment_date, x: yearsOf(f.payment_date), value: -f.yen_pv, series: "bond", label: "クーポン（円換算、支払）" }))}
        series={[{ key: "bond", label: "債券のクーポン（円換算、支払）", color: "var(--series-2)" }]} yLabel="現在価値（円）"
        formatY={(v) => v.toFixed(2)} footer={footer} />
      <div className="table-wrap">
        <table className="data">
          <caption>ヘッジ後の債券キャッシュフロー（{ccy} 額面100あたり）</caption>
          <thead><tr><th scope="col">支払日</th><th scope="col">種類</th><th scope="col" className="num">外貨額</th><th scope="col" className="num">FXフォワード</th><th scope="col" className="num">円額</th><th scope="col" className="num">円の割引係数</th><th scope="col" className="num">円の現在価値</th></tr></thead>
          <tbody>
            {x.hedged_cashflows.map((f) => (
              <tr key={`${f.payment_date}-${f.kind}`}><td>{f.payment_date}</td><td>{f.kind === "redemption" ? "償還" : "クーポン"}</td><td className="num">{f.foreign_amount.toFixed(6)}</td>
                <td className="num">{f.fx_forward.toFixed(6)}</td><td className="num">{f.yen_amount.toFixed(4)}</td><td className="num">{df(f.yen_discount)}</td><td className="num">{f.yen_pv.toFixed(4)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>z の校正と円換算ASW</h3>
      <p>z は、ベーシス b の通貨スワップが満期でちょうど等価になるように決める：Q_f(z) − Q_j − b·A_j = 0。そのうえで、</p>
      <p className="formula">s_j* = ( B_j − Q_j − U_j ) / A_j</p>
      <div className="table-wrap">
        <table className="data">
          <caption>計算の内訳（{ccy} 額面100あたり、円）　<Stamp r={d.response} /></caption>
          <thead><tr><th scope="col">記号</th><th scope="col">内容</th><th scope="col" className="num">値</th></tr></thead>
          <tbody>
            <tr><th scope="row">Q_f(z)</th><td>外貨翌日物レグ＋満期元本の円の現在価値（z で校正）</td><td className="num">{yen(c.foreign_base_leg_pv)}</td></tr>
            <tr><th scope="row">b·A_j</th><td>ベーシスの現在価値</td><td className="num">{yen(c.basis_annuity_pv)}</td></tr>
            {sumRows.map(([sym, label, v]) => <tr key={sym}><th scope="row">{sym}</th><td>{label}</td><td className="num">{yen(v)}</td></tr>)}
            <tr className="changed"><th scope="row">s_j*</th><td>(B_j − Q_j − U_j) / A_j × 10⁴</td><td className="num">{bpText(c.yen_asw_bp, 10)}</td></tr>
          </tbody>
        </table>
      </div>
      <table className="kv">
        <caption>比較と確かめ</caption>
        <tbody>
          <tr><th scope="row">発行通貨建て ASW ＋ ベーシス（単純和、参考値）</th><td>{y.simple_sum_bp !== undefined ? bpText(y.simple_sum_bp, 4) : "—"}（PV・支払日・アニュイティが違うので、円換算ASWとは一致しない）</td></tr>
          <tr><th scope="row">CCS 校正の残差 Q_f(z) − Q_j − b·A_j</th><td>{k.ccs_residual_yen.toExponential(2)} 円</td></tr>
          <tr><th scope="row">s_j* を戻したときの NPV</th><td>{k.npv_at_fair_spread_yen.toExponential(2)} 円</td></tr>
          <tr><th scope="row">内訳から組み立てた s_j* と rmql の compute_yen_asset_swap の差</th><td>{k.rebuilt_minus_engine_bp.toExponential(2)} bp</td></tr>
          <tr><th scope="row">ヘッジ後の債券PV・円の基準レグPV のエンジンとの差</th><td>{k.hedged_bond_pv_minus_engine.toExponential(2)} 円・{k.yen_base_leg_pv_minus_engine.toExponential(2)} 円</td></tr>
        </tbody>
      </table>
    </>
  );
}

function OfferAndAttributes({ d }: { d: AswDetailResponse }) {
  const o = d.offer;
  const a = d.attributes;
  const offerRows: [string, ReactNode][] = [
    ["オファー日", o.offer_date], ["業者", o.broker_names], ["単価（クリーン、額面100）", Number(o.offer_price).toFixed(2)],
    ["数量（額面）", `${new Intl.NumberFormat("ja-JP").format(Number(o.offer_size))}（表示単位：${o.offer_size_unit}）`],
    ["受渡日", o.offer_settlementdate], ["元のファイル", `${o.offer_source_file}（シート ${o.offer_source_sheet}、${o.offer_source_row}行目）`],
  ];
  const attrKeys: [string, string][] = [
    ["currency", "通貨"], ["coupon_type", "利率の種類"], ["coupon_rate", "クーポン"], ["coupon_frequency", "利払回数（年）"],
    ["issue_date", "発行日"], ["maturity_date", "満期日"], ["day_count", "経過利子の日数計算"], ["calendar", "カレンダー"],
    ["settlement_days", "受渡日数"], ["payment_convention", "支払日の調整"], ["first_call_date", "First Call日"],
    ["redemption", "償還額（額面100）"], ["attribute_date", "属性の日付"], ["attribute_source", "属性の出所"],
  ];
  const cols = d.offer_columns ?? [];
  const valueOf = (field: string): string => {
    const v = o[field];
    if (field === "offer_size") return `${new Intl.NumberFormat("ja-JP").format(Number(v))}（元の値 × ${new Intl.NumberFormat("ja-JP").format(cols[0]?.size_multiplier ?? 1)}）`;
    return v === null || v === undefined ? "—" : String(v);
  };
  return (
    <>
      <div className="two-col">
        <table className="kv"><caption>オファー</caption><tbody>{offerRows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>
        <table className="kv">
          <caption>銘柄属性（ISIN とオファー日で結合）</caption>
          <tbody>
            {a ? attrKeys.map(([k, label]) => (
              <tr key={k}><th scope="row">{label}</th><td>{k === "coupon_rate" && typeof a[k] === "number" ? pct(a[k] as number, 3) : String(a[k] ?? "—")}</td></tr>
            )) : <tr><td>属性が見つかりません</td></tr>}
          </tbody>
        </table>
      </div>
      {cols.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <caption>
              オファーシートの入力項目：{cols[0].file}（シート「{cols[0].sheet}」、見出しは {cols[0].header_row} 行目）。Curie の <code>convert_offer_sheet_Curie()</code> の対応
            </caption>
            <thead><tr><th scope="col">元の見出し</th><th scope="col">共通形式の列</th><th scope="col">このオファーの値</th></tr></thead>
            <tbody>
              {cols.map((c) => <tr key={c.source_header}><td>{c.source_header}</td><td><code>{c.field}</code></td><td className="wrap">{valueOf(c.field)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        入力検証（Curie と同じ問題コード）：{d.validation_issues.length ? <strong>{d.validation_issues.join("; ")}</strong> : "合格（問題なし）"}
      </p>
    </>
  );
}

function JgbSection({ d }: { d: AswDetailResponse }) {
  const j = d.jgb!;
  return (
    <>
      <h2>6. JGBスプレッド（円建て債券）</h2>
      <p>
        JGBスプレッド ＝（対象債の複利利回り − 同じ償還日に補間したJGB複利利回り）× 100 bp（Curie と同じ定義）。複利利回りは日本式（利払・複利とも年2回、
        残存年数は満年数＋端数ACT/365、小数第7位未満を切り捨て）で、JGB 利回りは同じ受渡日の JGB を償還日ごとに平均し、自然3次スプラインで補間する（外挿なし）。
      </p>
      {j.status !== "computed" ? (
        <div className="banner" role="status"><strong>計算できない</strong>　{j.reason}</div>
      ) : (
        <table className="kv">
          <tbody>
            <tr><th scope="row">残存年数（満年数＋端数ACT/365）</th><td>{j.remaining_years!.toFixed(7)}</td></tr>
            <tr><th scope="row">対象債の複利利回り（単価 {Number(d.offer.offer_price).toFixed(2)} から）</th><td>{j.compound_yield_pct!.toFixed(7)} %</td></tr>
            <tr><th scope="row">補間JGB複利利回り（満期 {String(d.attributes?.maturity_date)}）</th><td>{j.jgb_interpolated_yield_pct!.toFixed(7)} %</td></tr>
            <tr className="changed"><th scope="row">JGBスプレッド</th><td data-testid="jgb-spread-detail">{bpText(j.jgb_spread_bp!, 4)}（丸め前 <code>{j.jgb_spread_bp}</code>）</td></tr>
          </tbody>
        </table>
      )}
      <p className="note">
        オファーは単価で提示されている。JGB対比スプレッドで提示された場合の単価への換算は、<a href={href("/asw/poc")}>A1 オファーシート作成 POC</a> の 3.3 で試せる
        （Curie にはない機能で、Curie のJGBスプレッドの定義を逆に解く）。JGB の利回りと補間の明細は同じページの 5.2 にある。
      </p>
    </>
  );
}

function Computed({ d }: { d: AswDetailResponse }) {
  const x = d.detail!;
  const c = x.components;
  const origin = d.conditions.valuation_date;
  const maturityT = x.curve.points.find((p) => p.date >= d.summary!.maturity_date)?.time ?? x.curve.points[x.curve.points.length - 1].time;
  const xMax = Math.ceil(maturityT + 0.25);
  const pts = x.curve.points;
  const pillarDots = x.curve.quotes.flatMap((q) => {
    const p = pts.find((pt) => pt.date === q.pillar_date);
    return p && p.zero_continuous !== null ? [{ x: p.time, y: p.zero_continuous * 100, date: p.date }] : [];
  });
  const markers = [{ x: maturityT, label: "債券満期" }];
  const footer = <Stamp r={d.response} />;
  const [withPrincipal, setWithPrincipal] = useState(false); // the principal and redemption dwarf the coupons
  const yearsOf = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000 / 365;
  const bars: FlowBar[] = [
    ...x.bond_cashflows.filter((f) => withPrincipal || f.kind !== "redemption").map((f) => ({
      date: f.payment_date, x: yearsOf(f.payment_date), value: -f.pv, series: "bond",
      label: f.kind === "redemption" ? "債券の償還（支払）" : "債券のクーポン（支払）",
    })),
    ...x.overnight_cashflows.map((f) => ({ date: f.payment_date, x: yearsOf(f.payment_date), value: f.pv, series: "on", label: "翌日物レグ（受取）" })),
    ...(withPrincipal ? [{ date: x.principal.payment_date, x: yearsOf(x.principal.payment_date), value: x.principal.amount * x.principal.discount, series: "on", label: "元本（受取）" }] : []),
  ];
  const sumRows: [string, string, number][] = [
    ["B", "債券キャッシュフローの現在価値（支払）", c.bond_pv],
    ["L", "翌日物レグの現在価値（スプレッド0、受取）", c.overnight_pv],
    ["R", "満期の元本100の現在価値（受取）", c.principal_pv],
    ["U·D(t,S)", "受渡日の価格調整の現在価値", c.upfront_pv],
    ["A", "スプレッドのアニュイティ（額面100 × 年数 × 割引係数の和）", c.annuity],
  ];
  return (
    <>
      <h2>2. 適用したカーブ</h2>
      <p>
        {x.curve.currency} の {x.curve.index} OIS カーブ。市場日 {x.curve.marketdate}（取得時刻 {x.curve.quote_time}）、受渡日数 {x.curve.settlement_days}、
        OIS 年{x.curve.payment_frequency}回払い・支払ラグ{x.curve.payment_lag}、カーブの時間軸 {x.curve.day_count}、割引係数の単調対数3次補間、外挿なし。
        翌日物レグの予測と、すべてのキャッシュフローの割引に同じカーブを使う。出所：{x.curve.source}
      </p>
      <div className="table-wrap">
        <table className="data">
          <caption>OISクォートと再現（レートは %）</caption>
          <thead><tr><th scope="col">年限</th><th scope="col" className="num">クォート</th><th scope="col">開始日</th><th scope="col">ピラー</th><th scope="col" className="num">再現したレート</th><th scope="col" className="num">再現誤差</th></tr></thead>
          <tbody>
            {x.curve.quotes.map((q) => (
              <tr key={q.tenor}><th scope="row">{q.tenor}</th><td className="num">{pct(q.rate, 2)}</td><td>{q.start_date}</td><td>{q.pillar_date}</td>
                <td className="num">{pct(q.implied_rate, 8)}</td><td className="num">{q.reproduction_error.toExponential(1)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <LineChart title={`${x.curve.index} OIS 割引係数カーブ`} origin={origin} xMax={xMax} yLabel="割引係数"
        series={[{ key: "df", label: "割引係数", color: "var(--series-1)", points: pts.map((p) => ({ x: p.time, y: p.discount, date: p.date })) }]}
        formatY={(y) => df(y, 10)} formatTick={(y) => y.toFixed(3)} markers={markers} footer={footer} />
      <LineChart title={`${x.curve.index} OIS 連続複利ゼロ金利（Actual/365 Fixed、点はピラー）`} origin={origin} xMax={xMax} yLabel="ゼロ金利（%）"
        series={[{ key: "zero", label: "ゼロ金利", color: "var(--series-1)",
          points: pts.flatMap((p) => (p.zero_continuous === null ? [] : [{ x: p.time, y: p.zero_continuous * 100, date: p.date }])), dots: pillarDots }]}
        formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} markers={markers} footer={footer} />

      <h2>3. 価格の入力と換算</h2>
      <table className="kv">
        <tbody>
          <tr><th scope="row">クリーン価格 P（オファー単価）</th><td className="num-cell">{per100(x.price.clean_price, 2)}</td></tr>
          <tr><th scope="row">経過利子 AI（受渡日 {x.price.settlement_date}、{x.price.accrual_day_count}）</th><td className="num-cell">{per100(x.price.accrued, 10)}</td></tr>
          <tr><th scope="row">ダーティ価格 P_d = P + AI</th><td className="num-cell">{per100(x.price.dirty_price, 10)}</td></tr>
          <tr><th scope="row">受渡日の価格調整 U = N (P_d/100 − 1)（N = 100）</th><td className="num-cell">{per100(x.price.upfront, 10)}</td></tr>
          <tr><th scope="row">受渡日の割引係数 D(t,S)</th><td className="num-cell">{df(x.price.upfront_discount, 12)}</td></tr>
          <tr><th scope="row">価格調整の現在価値 U·D(t,S)</th><td className="num-cell">{per100(x.price.upfront_pv, 10)}</td></tr>
        </tbody>
      </table>
      <p className="note">オファーは価格で提示されている（スプレッド提示ではない）ので、価格からスプレッドへの換算だけを行う。他の条件を固定すると、価格が1上がるごとに ASW は {x.checks.price_sensitivity_bp_per_price.toFixed(4)} bp 動く。</p>

      <h2>4. 債券とスワップのキャッシュフロー</h2>
      <div className="range" role="group" aria-label="表示する金額">
        <button type="button" aria-pressed={!withPrincipal} onClick={() => setWithPrincipal(false)}>利息だけ</button>
        <button type="button" aria-pressed={withPrincipal} onClick={() => setWithPrincipal(true)}>元本・償還を含む</button>
      </div>
      <FlowChart title="支払日ごとの現在価値（額面100あたり。受取は上、支払は下）" origin={origin} xMax={xMax} bars={bars}
        series={[{ key: "on", label: "翌日物レグ・元本（受取）", color: "var(--series-1)" }, { key: "bond", label: "債券のクーポン・償還（支払）", color: "var(--series-2)" }]}
        yLabel="現在価値（額面100）" formatY={(y) => y.toFixed(Math.abs(y) < 5 ? 4 : 2)} footer={footer} />
      <div className="table-wrap">
        <table className="data">
          <caption>債券のキャッシュフロー（受渡日より後、額面100あたり）</caption>
          <thead><tr><th scope="col">支払日</th><th scope="col">種類</th><th scope="col">計算期間</th><th scope="col" className="num">金額</th><th scope="col" className="num">割引係数</th><th scope="col" className="num">現在価値</th></tr></thead>
          <tbody>
            {x.bond_cashflows.map((f) => (
              <tr key={`${f.payment_date}-${f.kind}`}><td>{f.payment_date}</td><td>{f.kind === "redemption" ? "償還" : "クーポン"}</td>
                <td>{f.accrual_start ? `${f.accrual_start} 〜 ${f.accrual_end}` : "—"}</td><td className="num">{per100(f.amount, 6)}</td>
                <td className="num">{df(f.discount)}</td><td className="num">{per100(f.pv, 6)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>スワップの翌日物レグ（日次複利、スプレッド0、額面100あたり）とスプレッドの単位額</caption>
          <thead><tr><th scope="col">計算期間</th><th scope="col">支払日</th><th scope="col" className="num">翌日物の額</th><th scope="col" className="num">スプレッド1あたりの額（年数×100）</th><th scope="col" className="num">割引係数</th><th scope="col" className="num">翌日物の現在価値</th></tr></thead>
          <tbody>
            {x.overnight_cashflows.map((f) => (
              <tr key={f.payment_date}><td>{f.accrual_start} 〜 {f.accrual_end}</td><td>{f.payment_date}</td><td className="num">{per100(f.amount, 6)}</td>
                <td className="num">{per100(f.spread_unit, 6)}</td><td className="num">{df(f.discount)}</td><td className="num">{per100(f.pv, 6)}</td></tr>
            ))}
            <tr><td>元本</td><td>{x.principal.payment_date}</td><td className="num">{per100(x.principal.amount, 2)}</td><td className="num">—</td>
              <td className="num">{df(x.principal.discount)}</td><td className="num">{per100(x.principal.amount * x.principal.discount, 6)}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>5. ASWスプレッドの計算</h2>
      <p>
        債券のキャッシュフローを支払い、翌日物レグ＋スプレッド s と満期の元本を受け取り、受渡日にダーティ価格と100の差を授受する。NPV がゼロになるスプレッドが ASW である。
      </p>
      <p className="formula">s* = ( B − L − R − U·D(t,S) ) / A</p>
      <div className="table-wrap">
        <table className="data">
          <caption>計算の内訳（額面100あたり）　<Stamp r={d.response} /></caption>
          <thead><tr><th scope="col">記号</th><th scope="col">内容</th><th scope="col" className="num">値</th></tr></thead>
          <tbody>
            {sumRows.map(([sym, label, v]) => <tr key={sym}><th scope="row">{sym}</th><td>{label}</td><td className="num">{per100(v, 10)}</td></tr>)}
            <tr className="changed"><th scope="row">s*</th><td>(B − L − R − U·D) / A × 10⁴</td><td className="num">{bpText(c.fair_spread_bp, 10)}</td></tr>
          </tbody>
        </table>
      </div>
      <table className="kv">
        <caption>確かめ</caption>
        <tbody>
          <tr><th scope="row">キャッシュフローから組み立てた s* と、rmql の compute_ois_asset_swap の差</th><td>{x.checks.rebuilt_minus_engine_bp.toExponential(2)} bp</td></tr>
          <tr><th scope="row">s* を戻したときの NPV（額面100）</th><td>{x.checks.npv_at_fair_spread.toExponential(2)}</td></tr>
        </tbody>
      </table>
    </>
  );
}
