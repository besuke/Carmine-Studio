import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { fetchAswReport, postJgbSpread, type AswReport, type JgbSpreadQuote, type ReportOffer } from "../api/asw";
import { href } from "../book/router";
import { LineChart } from "../components/LineChart";
import { UsageGuide } from "../components/UsageGuide";

// Curie docs/A1_offer_sheet_POC.qmd as a React page. The sections and tables follow the QMD (the a1_*_table_Curie()
// tables of R/a1_offer_sheet/report_tables.R, with the same columns, digits and labels). The numbers come from the
// R API (rmql); under each table, a check compares them with the old Curie demo run (2026-10-27).

// ---- Formatting as Curie's report_format.R -------------------------------------------------------------
const nf = (digits: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** format_number_Curie: fixed digits with thousands separators; NA is 未計算 (not computed) or 欠損 (missing). */
function num(x: number | null | undefined, digits: number, computed = true): string {
  if (x === null || x === undefined || Number.isNaN(x)) return computed ? "欠損" : "未計算";
  return nf(digits).format(x);
}
const sci = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toExponential(2));
const PRICING_LABEL: Record<string, string> = { success: "成功", partial: "一部未計算", failed: "失敗", unsupported: "未対応", skipped: "入力不備" };
const VALIDATION_LABEL: Record<string, string> = { valid: "合格", invalid: "不合格" };

// ---- Table helpers ------------------------------------------------------------------------------------
interface Col<T> { key: string; label: ReactNode; right?: boolean; cell: (row: T) => ReactNode }
function Table<T>({ caption, cols, rows, rowKey }: { caption: ReactNode; cols: Col<T>[]; rows: T[]; rowKey: (r: T, i: number) => string }) {
  return (
    <div className="table-wrap">
      <table className="data poc">
        <caption>{caption}</caption>
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className={c.right ? "num" : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>{cols.map((c) => <td key={c.key} className={c.right ? "num" : "wrap"}>{c.cell(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line of a check: the largest |React − Curie| over the rows that both have, against a tolerance. */
interface Check { item: string; unit: string; pairs: [number | null | undefined, number | null | undefined][]; tolerance: number; exact?: boolean }
function CheckTable({ caption, checks }: { caption: string; checks: Check[] }) {
  const rows = checks.map((c) => {
    const both = c.pairs.filter(([a, b]) => typeof a === "number" && typeof b === "number") as [number, number][];
    const onlyOne = c.pairs.filter(([a, b]) => (typeof a === "number") !== (typeof b === "number")).length;
    const max = both.reduce((m, [a, b]) => Math.max(m, Math.abs(a - b)), 0);
    const ok = onlyOne === 0 && both.length > 0 && (c.exact ? max === 0 : max <= c.tolerance);
    return { ...c, n: both.length, onlyOne, max, ok };
  });
  return (
    <div className="table-wrap">
      <table className="data poc check">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">項目</th><th scope="col" className="num">比べた件数</th><th scope="col" className="num">最大差 |React − Curie|</th><th scope="col" className="num">許容誤差</th><th scope="col">判定</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item}>
              <th scope="row">{r.item}</th>
              <td className="num">{r.n}{r.onlyOne ? `（片方だけ ${r.onlyOne}）` : ""}</td>
              <td className="num">{r.max === 0 ? "0" : r.max.toExponential(2)} {r.unit}</td>
              <td className="num">{r.exact ? "完全一致" : `${r.tolerance.toExponential(0)} ${r.unit}`}</td>
              <td><span className={`status ${r.ok ? "status-computed" : "status-failed"}`} data-testid="poc-check">{r.ok ? "一致" : "不一致"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const refNum = (o: ReportOffer, key: string) => {
  const v = o.reference?.[key];
  return typeof v === "number" ? v : null;
};
const sameText = (a: string, b: unknown) => (a === (typeof b === "string" ? b : "") ? 0 : 1);

// ---- Page ---------------------------------------------------------------------------------------------
export function AswPocPage() {
  const [state, setState] = useState<{ data: AswReport | null; error: string | null }>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState({ data: null, error: null });
    fetchAswReport({ signal: c.signal })
      .then((data) => setState({ data, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ data: null, error: e instanceof ApiError ? e.message : String(e) });
      });
    return () => c.abort();
  }, [attempt]);
  const d = state.data;
  return (
    <article className="prose wide poc-doc">
      <h1>Curie A1 オファーシート作成 POC（React 版）</h1>
      <p className="subtitle">既存のA1ワークフローの入力・計算条件・結果・制約を確認する。原本は Curie の <code>docs/A1_offer_sheet_POC.qmd</code></p>
      {state.error && (
        <div className="banner error" role="alert">
          <strong>R APIの応答を受け取れませんでした。</strong> {state.error}
          <div className="banner-cmd">起動コマンド：<code>npm run api</code></div>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>再試行</button>
        </div>
      )}
      {!d && !state.error && <p className="muted">R APIで計算中…</p>}
      {d && <Report d={d} />}
    </article>
  );
}

function Report({ d }: { d: AswReport }) {
  const jpy = d.offers.filter((o) => o.book === "JPY");
  const iso = d.offers.filter((o) => o.book === "ISO");
  return (
    <>
      <nav className="poc-toc" aria-label="この文書の目次">
        <ol>
          <li><a href="#poc-1">このPOCの位置づけ</a></li>
          <li><a href="#poc-2">入力データとオファーシートの入力項目</a></li>
          <li><a href="#poc-3">JPYワークフロー</a></li>
          <li><a href="#poc-4">ISOワークフロー</a></li>
          <li><a href="#poc-5">検証明細</a></li>
          <li><a href="#poc-6">未対応商品・計算条件・簡易モデルの制約</a></li>
        </ol>
        <p className="muted">API応答 <code data-request-id={d.response.request_id}>{d.response.request_id}</code>（評価日 {d.valuation_date}）</p>
      </nav>
      <Positioning />
      <Inputs d={d} />
      <Workflow d={d} book="JPY" offers={jpy} />
      <Workflow d={d} book="ISO" offers={iso} />
      <Verification d={d} />
      <Limits />
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="poc-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// 1 ----------------------------------------------------------------------------------------------------
function Positioning() {
  return (
    <Section id="poc-1" title="1 このPOCの位置づけ">
      <p>
        本ページは、Curieの <strong>A1 オファーシート作成</strong> の POC を、React と R の HTTP API で作り直したものである。章立てと表は原本の QMD に合わせ、
        表の数値は R の API が <strong>rmql</strong> で計算する。各表の下に、Curie の旧デモ（2026-10-27 実行、GaussQuant・QuantLib 1.42）との差を示す。
      </p>
      <table className="kv">
        <tbody>
          <tr><th scope="row">対象</th><td>A1 オファーシート作成（デモ実装済み・本番連携は未完了）</td></tr>
          <tr><th scope="row">JPY</th><td>JPY建ての債券（ユーロ円債を含む）。JPY OIS ASW と JGBスプレッド</td></tr>
          <tr><th scope="row">ISO</th><td>円以外の建て通貨（デモはUSD・EUR）。自国通貨OIS ASW と 円換算ASW</td></tr>
          <tr><th scope="row">データ</th><td><strong>すべて架空のテスト用データ</strong>。実在の銘柄・市場価格ではない</td></tr>
          <tr><th scope="row">表</th><td>R API の計算結果から作る（Curie の出力Excelは、照合の参照値としてだけ使う）</td></tr>
        </tbody>
      </table>
      <h3>Curie全体の中での位置づけ（<code>CURIE_Mockup_Overview.pdf</code> 4ページ）</h3>
      <div className="role-grid">
        <div className="role-input"><span className="muted">入力</span><br />所定の市場レート ＋ オファーシート ＋ 業者時価（ICE・DIR） ＋ 当社指定ASW</div>
        <div className="role-r">
          <strong>R：計算・検証・数値集計を確定する</strong>
          <ol>
            <li className="here"><strong>01 オファーを計算・整理</strong>：市場レートとオファー価格から利回り・ASW等を計算（<strong>このページ</strong>）</li>
            <li>02 当社理論時価と既存時価を検証</li>
            <li>03 オファーシートサマリーを集計</li>
          </ol>
        </div>
        <div className="role-ai"><strong>AI：確定結果と信用資料を要約する</strong><br />数値はRで確定し、AIによる要約（A3・A4）は確定した数値を変更しない。</div>
      </div>
      <p>本番連携で未完了の内容：</p>
      <ul>
        <li>Aladdin APIによる銘柄属性取得（本ページではデモの属性を使う）</li>
        <li>実際の入力ファイル（オファーExcel、OIS、JGB時価、FX、ベーシス）への対応・確認</li>
        <li>ASW翌日物レッグの実取引条件の確定（本ページでは半年払い・支払ラグ0をデモの仮定として使う）</li>
        <li>JGB対比スプレッドで提示されたオファーの取込（Curie は単価での提示だけを扱う。3.3 を参照）</li>
      </ul>
    </Section>
  );
}

// 2 ----------------------------------------------------------------------------------------------------
const FIELD_LABEL: Record<string, string> = {
  offer_date: "オファー日（評価日・市場日と一致させる）", ISIN: "ISIN（前後空白除去・英大文字化。形式とチェックディジットを確認）",
  offer_security_name: "銘柄名（表示用。属性の銘柄名を優先）", broker_names: "業者名", offer_price: "単価（額面100あたりのクリーン価格）",
  offer_size: "数量（額面金額。見出しの単位で換算）", offer_settlementdate: "受渡日（債券の受渡日と一致した行だけ計算）",
  offer_currency: "通貨（属性の通貨と一致を確認）", sheet_issue_price: "参考:発行価格（属性の発行価格と一致を確認。評価には使わない）",
};

function Inputs({ d }: { d: AswReport }) {
  const prov = d.provenance.filter((l) => l.startsWith("| `"));
  return (
    <Section id="poc-2" title="2 入力データとオファーシートの入力項目">
      <p>
        原本の 2〜4 章（Curieルートの解決、パッケージの読込、デモ入力データの生成）は R の実行環境の準備なので、このページでは、R API が使う入力データの出所に置き換える。
        データは Curie の <code>data/demo</code> と旧デモの結果を複製したもの（<code>server/data/asw_demo/</code>）。
      </p>
      <div className="table-wrap">
        <table className="data poc">
          <caption>入力データ（Curie からの複製。SHA-256 は Curie の元ファイル）</caption>
          <thead><tr><th scope="col">このフォルダ</th><th scope="col">Curie の元ファイル</th><th scope="col">更新日時</th><th scope="col">SHA-256（先頭16桁）</th></tr></thead>
          <tbody>
            {prov.map((l) => {
              const c = l.split("|").map((s) => s.trim().replace(/`/g, "")).filter(Boolean);
              return <tr key={c[1]}><td>{c[0]}</td><td className="wrap">{c[1]}</td><td>{c[2]}</td><td><code>{c[3].slice(0, 16)}</code></td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <h3>オファーシートの入力項目</h3>
      <p>
        オファーExcelは、Curie の <code>convert_offer_sheet_Curie()</code> が見出し行を探して共通形式に変換する。シート名や列の位置には依存しない。
        JPYのブックには候補シートが2つ（「円債オファー」と「円債オファー_訂正前」）あるため、シートを明示して読む。必須の6列は
        <code>offer_date</code>・<code>ISIN</code>・<code>broker_names</code>・<code>offer_price</code>・<code>offer_size</code>・<code>offer_settlementdate</code>。
      </p>
      {(["JPY", "ISO"] as const).map((book) => {
        const cols = d.inputs[book].columns;
        return (
          <Table key={book} rows={cols} rowKey={(c) => c.source_header}
            caption={`${book}：${cols[0]?.file}（シート「${cols[0]?.sheet}」、見出しは ${cols[0]?.header_row} 行目、数量の単位 ${cols[0]?.size_unit} → ×${nf(0).format(cols[0]?.size_multiplier ?? 0)}）`}
            cols={[
              { key: "h", label: "元の見出し", cell: (c) => c.source_header },
              { key: "f", label: "共通形式の列", cell: (c) => <code>{c.field}</code> },
              { key: "m", label: "意味・扱い", cell: (c) => FIELD_LABEL[c.field] ?? "" },
            ]} />
        );
      })}
      <p className="note">
        オファー単価は<strong>価格（クリーン）での提示だけ</strong>を受け付ける（<code>offer_price</code> は必須で正の値）。JGB対比スプレッドは入力ではなく、単価から計算する出力である。
      </p>
    </Section>
  );
}

// 3, 4 -------------------------------------------------------------------------------------------------
function Workflow({ d, book, offers }: { d: AswReport; book: "JPY" | "ISO"; offers: ReportOffer[] }) {
  const n = book === "JPY" ? 3 : 4;
  const log = d.inputs[book].market_log;
  const summary = new Map<string, number>();
  for (const o of offers) {
    const k = `${o.currency}|${o.validation_status}|${o.pricing_status}`;
    summary.set(k, (summary.get(k) ?? 0) + 1);
  }
  const sumRows = [...summary.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    const [ccy, val, pr] = k.split("|");
    return { ccy, val: VALIDATION_LABEL[val], pr: PRICING_LABEL[pr], n: String(v) };
  });
  sumRows.push({ ccy: "合計", val: "", pr: "", n: String(offers.length) });
  const condRows = [
    { k: "オファー", f: d.inputs[book].offer_file, m: d.valuation_date, t: "—", s: "使用" },
    ...log.map((l) => ({ k: String(l.data_type), f: String(l.source_file), m: String(l.marketdates), t: String(l.quote_times ?? "—"), s: String(l.status) })),
    { k: "銘柄属性", f: d.attributes_source.join(", "), m: d.valuation_date, t: "—", s: "使用" },
    { k: "評価日", f: d.valuation_date, m: "—", t: "—", s: "オファー日・市場日と一致させる" },
    { k: "オファー受渡日", f: [...new Set(offers.map((o) => o.settlement_date))].join(", "), m: "—", t: "—", s: "債券の受渡日と一致した行だけ計算" },
    { k: "ASW翌日物レッグ", f: `Semiannual、支払ラグ ${d.conditions.asw_overnight_leg.payment_lag}`, m: "—", t: "—", s: d.conditions.asw_overnight_leg.note },
  ];
  const exceptions = offers.filter((o) => o.pricing_status !== "success");
  return (
    <Section id={`poc-${n}`} title={`${n} ${book}ワークフロー`}>
      <p>{book === "JPY"
        ? "JPYとISOは、オファーExcelも市場データの読込時点も別である。JPYだけを単独で計算する。"
        : "ISOだけを単独で計算する。OISは通貨ごとに別ファイルで渡し、円換算ASWに使うJPYのOISも含める。"}</p>
      <h3>{n}.1 評価条件と件数</h3>
      <Table caption={`${book}：入力ファイルと評価条件`} rows={condRows} rowKey={(r) => r.k + r.f} cols={[
        { key: "k", label: "区分", cell: (r) => r.k }, { key: "f", label: "ファイル", cell: (r) => r.f },
        { key: "m", label: "市場日", cell: (r) => r.m }, { key: "t", label: "取得時刻", cell: (r) => r.t }, { key: "s", label: "状態", cell: (r) => r.s },
      ]} />
      <Table caption={`${book}：入力件数・検証状態・計算状態`} rows={sumRows} rowKey={(r, i) => `${r.ccy}${i}`} cols={[
        { key: "c", label: "通貨", cell: (r) => r.ccy }, { key: "v", label: "入力検証", cell: (r) => r.val },
        { key: "p", label: "計算状態", cell: (r) => r.pr }, { key: "n", label: "件数", right: true, cell: (r) => r.n },
      ]} />
      <CheckTable caption={`${book}：入力検証と計算状態の照合（Curie の旧デモと同じ判定か）`} checks={[
        { item: "入力検証の問題コード", unit: "件", tolerance: 0, exact: true,
          pairs: offers.map((o) => [0, sameText(o.validation_issues.join("; "), o.reference?.validation_message ?? "")]) },
        { item: "計算状態", unit: "件", tolerance: 0, exact: true,
          pairs: offers.map((o) => [0, sameText(o.pricing_status, o.reference?.pricing_status)]) },
      ]} />
      <h3>{n}.2 計算結果</h3>
      {book === "JPY" ? <JpyResults offers={offers} /> : <IsoResults offers={offers} />}
      <Table caption={`${book}：未対応・失敗した銘柄と理由`} rowKey={(r) => r.offer_id}
        rows={exceptions.length ? exceptions : []}
        cols={[
          { key: "n", label: "銘柄名", cell: (r) => r.security_name }, { key: "i", label: "ISIN", cell: (r) => r.ISIN },
          { key: "s", label: "計算状態", cell: (r) => PRICING_LABEL[r.pricing_status] },
          { key: "c", label: "入力検証の問題コード", cell: (r) => r.validation_issues.length ? r.validation_issues.join("; ") : "—" },
          { key: "r", label: "理由", cell: (r) => r.pricing_message },
        ]} />
      {!exceptions.length && <p className="muted">（該当なし）</p>}
      {book === "JPY" && <JgbSpreadQuoteSection offers={offers.filter((o) => o.pricing_status === "success")} />}
    </Section>
  );
}

function JpyResults({ offers }: { offers: ReportOffer[] }) {
  return (
    <>
      <p>JGBスプレッドは（対象債の複利利回り − 同じ償還日に補間したJGB複利利回り）× 100 bp。「未計算」は計算状態が成功以外で値を計算していないこと、「欠損」は計算したはずの値が欠けていること（要確認）を表す。</p>
      <Table caption="JPY：計算結果（スプレッドの単位はbp）" rows={offers} rowKey={(o) => o.offer_id} cols={[
        { key: "n", label: "銘柄名", cell: (o) => <a href={href(`/asw/${o.offer_id}`)}>{o.security_name}</a> },
        { key: "i", label: "ISIN", cell: (o) => o.ISIN },
        { key: "p", label: <>オファー単価<br />（額面100・クリーン）</>, right: true, cell: (o) => num(o.offer_price, 2) },
        { key: "y", label: <>複利利回り<br />（%）</>, right: true, cell: (o) => num(o.jpy_compound_yield_pct, 4, o.pricing_status === "success") },
        { key: "j", label: <>補間JGB利回り<br />（%）</>, right: true, cell: (o) => num(o.jgb_interpolated_yield_pct, 4, o.pricing_status === "success") },
        { key: "a", label: <>JPY OIS ASW<br />（bp）</>, right: true, cell: (o) => num(o.native_asw_bp, 1, o.pricing_status === "success") },
        { key: "s", label: <>JGBスプレッド<br />（bp）</>, right: true, cell: (o) => <span data-testid={`poc-jgb-${o.offer_id}`}>{num(o.jgb_spread_bp, 1, o.pricing_status === "success")}</span> },
        { key: "st", label: "計算状態", cell: (o) => PRICING_LABEL[o.pricing_status] },
      ]} />
      <CheckTable caption="JPY：計算結果の照合（丸める前の値）" checks={[
        { item: "複利利回り", unit: "%", tolerance: 1e-10, pairs: offers.map((o) => [o.jpy_compound_yield_pct, refNum(o, "jpy_compound_yield_pct")]) },
        { item: "補間JGB利回り", unit: "%", tolerance: 1e-10, pairs: offers.map((o) => [o.jgb_interpolated_yield_pct, refNum(o, "jgb_interpolated_yield_pct")]) },
        { item: "JPY OIS ASW", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.native_asw_bp, refNum(o, "native_asw_bp")]) },
        { item: "JGBスプレッド", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.jgb_spread_bp, refNum(o, "jgb_spread_bp")]) },
      ]} />
    </>
  );
}

function IsoResults({ offers }: { offers: ReportOffer[] }) {
  return (
    <>
      <p>円換算ASWの評価値は「円換算ASW」。「参考：単純合算」（自国通貨OIS ASW＋ベーシス）は比較用で、評価には使わない。</p>
      <Table caption="ISO：計算結果（スプレッドの単位はbp。評価値は円換算ASW、単純合算は参考）" rows={offers} rowKey={(o) => o.offer_id} cols={[
        { key: "n", label: "銘柄名", cell: (o) => <a href={href(`/asw/${o.offer_id}`)}>{o.security_name}</a> },
        { key: "i", label: "ISIN", cell: (o) => o.ISIN }, { key: "c", label: "通貨", cell: (o) => o.currency },
        { key: "p", label: <>オファー単価<br />（額面100・クリーン）</>, right: true, cell: (o) => num(o.offer_price, 2) },
        { key: "a", label: <>自国通貨<br />OIS ASW（bp）</>, right: true, cell: (o) => num(o.native_asw_bp, 1, o.pricing_status === "success") },
        { key: "b", label: <>補間ベーシス<br />（bp）</>, right: true, cell: (o) => num(o.basis_bp, 2, o.pricing_status === "success") },
        { key: "y", label: <>円換算ASW<br />（bp）</>, right: true, cell: (o) => num(o.yen_asw_bp, 1, o.pricing_status === "success") },
        { key: "s", label: <>参考：単純合算<br />（bp）</>, right: true, cell: (o) => num(o.simple_sum_bp, 1, o.pricing_status === "success") },
        { key: "st", label: "計算状態", cell: (o) => PRICING_LABEL[o.pricing_status] },
      ]} />
      <CheckTable caption="ISO：計算結果の照合（丸める前の値）" checks={[
        { item: "自国通貨 OIS ASW", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.native_asw_bp, refNum(o, "native_asw_bp")]) },
        { item: "補間ベーシス", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.basis_bp, refNum(o, "basis_bp")]) },
        { item: "円換算ASW", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.yen_asw_bp, refNum(o, "jpy_asw_bp")]) },
        { item: "参考：単純合算", unit: "bp", tolerance: 1e-6, pairs: offers.map((o) => [o.simple_sum_bp, refNum(o, "simple_sum_bp")]) },
      ]} />
    </>
  );
}

// 3.3 A quote given as a spread over JGBs -----------------------------------------------------------------
function JgbSpreadQuoteSection({ offers }: { offers: ReportOffer[] }) {
  const [offerId, setOfferId] = useState(offers[0]?.offer_id ?? "");
  const offer = offers.find((o) => o.offer_id === offerId);
  const [spread, setSpread] = useState(() => (offer?.jgb_spread_bp ?? 0).toFixed(1));
  const [result, setResult] = useState<JgbSpreadQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function convert() {
    setBusy(true);
    setError(null);
    try {
      setResult(await postJgbSpread(offerId, Number(spread)));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>3.3 JGB対比スプレッドで提示された気配の扱い</h3>
      <p>
        <strong>Curie の現行の A1 は、JGB対比スプレッドで提示された気配を入力として扱わない。</strong>オファーシートの必須項目は単価（<code>offer_price</code>、額面100あたりのクリーン価格）で、
        列の対応表にスプレッドの列はない。JGBスプレッドは、単価から計算する出力である。
      </p>
      <p>
        ここでは参考として、スプレッドで提示された場合に、Curie のJGBスプレッドの定義を逆に解いて単価に換算する。同じ受渡日・複利年2回で、
        利回り = 補間JGB複利利回り ＋ スプレッド/100 とし、日本式の複利の価格式（残存年数は満年数＋端数ACT/365）で単価を求める。
        <strong>特定のベンチマーク銘柄対比や単利利回りでの提示には対応しない</strong>ので、実際の提示方法を確かめてから使う。
      </p>
      <UsageGuide
        lead="円債のオファーを JGB 対比スプレッドで受けた場合に、単価へ換算する。初期値は、選んだ銘柄の単価から計算した JGB 対比スプレッドである。"
        steps={[
          { text: <><b>銘柄</b> を選ぶ（円債 JPY-01〜JPY-05）。</> },
          { text: <><b>JGB対比スプレッド（bp）</b> に値を入れる。例：JPY-01 の初期値から 0.5 bp 上げる。</> },
          { text: <><b>単価に換算</b> を押し、換算結果の表で <b>単価（切り捨てなし）</b> と <b>その単価での JPY OIS ASW</b> を見る。</> },
        ]}
      />
      <div className="controls" role="group" aria-label="JGB対比スプレッドの換算">
        <label>銘柄{" "}
          <select value={offerId} onChange={(e) => { setOfferId(e.target.value); const o = offers.find((x) => x.offer_id === e.target.value); setSpread((o?.jgb_spread_bp ?? 0).toFixed(1)); setResult(null); }}>
            {offers.map((o) => <option key={o.offer_id} value={o.offer_id}>{o.offer_id} {o.security_name}</option>)}
          </select>
        </label>
        <label>JGB対比スプレッド（bp）{" "}
          <input type="number" step="0.1" value={spread} onChange={(e) => setSpread(e.target.value)} aria-label="JGB対比スプレッド（bp）" />
        </label>
        <button type="button" className="primary" onClick={convert} disabled={busy || !offerId || spread === ""}>単価に換算</button>
        {offer && <span className="controls-state">オファー単価 {num(offer.offer_price, 2)}、単価から計算したJGBスプレッド {num(offer.jgb_spread_bp, 4)} bp</span>}
      </div>
      {error && <p className="banner error" role="alert">{error}</p>}
      {result && (
        <table className="kv" data-testid="jgb-quote-result">
          <caption>換算結果　<span className="response-tag">API応答 <code>{result.response.request_id}</code></span></caption>
          <tbody>
            <tr><th scope="row">補間JGB複利利回り</th><td>{num(result.jgb_interpolated_yield_pct, 7)} %</td></tr>
            <tr><th scope="row">対象債の複利利回り = 補間JGB利回り ＋ スプレッド/100</th><td>{num(result.compound_yield_pct, 7)} %</td></tr>
            <tr><th scope="row">残存年数（満年数＋端数ACT/365）</th><td>{num(result.remaining_years, 7)}</td></tr>
            <tr><th scope="row">単価（切り捨てなし）</th><td data-testid="jgb-quote-price">{num(result.clean_price, 6)}</td></tr>
            <tr><th scope="row">単価（小数第3位未満を切り捨て）</th><td>{num(result.clean_price_3dp, 3)}</td></tr>
            <tr><th scope="row">その単価での JPY OIS ASW</th><td>{num(result.native_asw_bp, 4)} bp</td></tr>
            <tr><th scope="row">戻し確認：単価から計算したJGBスプレッド</th><td>{num(result.round_trip_spread_bp, 6)} bp（利回りを小数第7位で切り捨てるため、入力と最大で 1e-5 bp 程度ずれる）</td></tr>
          </tbody>
        </table>
      )}
    </>
  );
}

// 5 ----------------------------------------------------------------------------------------------------
function Verification({ d }: { d: AswReport }) {
  const refCurve = (ccy: string) => [...d.curve_reference.JPY, ...d.curve_reference.ISO].find((r) => r.currency === ccy);
  const jgbRef = (isin: string) => d.jgb.reference_yields.find((r) => r.ISIN === isin);
  const avgRef = (m: string) => d.jgb.reference_average.find((r) => r.maturity_date === m);
  const jpyOk = d.offers.filter((o) => o.book === "JPY" && o.pricing_status === "success");
  const settle = d.jgb.settlement_date;
  const yearsFrom = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 / 365;
  const isoOk = d.offers.filter((o) => o.book === "ISO" && o.pricing_status === "success");
  return (
    <Section id="poc-5" title="5 検証明細">
      <h3>5.1 OISカーブの気配再現誤差</h3>
      <p>構築したカーブで入力気配を再評価し、誤差が 1e-4 bp を超えないことを確かめる（Curie の <code>instance_swap_curve()</code> の基準）。ISOワークフローは USD・EUR と、円換算に使う JPY のカーブを使う。</p>
      <Table caption="OISカーブの気配再現誤差（JPY・USD・EUR）" rows={d.curve_check} rowKey={(r) => r.currency} cols={[
        { key: "c", label: "通貨", cell: (r) => r.currency }, { key: "s", label: "状態", cell: (r) => (r.status === "success" ? "成功" : "失敗") },
        { key: "i", label: "指標", cell: (r) => r.index }, { key: "m", label: "市場日", cell: (r) => r.marketdate },
        { key: "t", label: "取得時刻", cell: (r) => r.quote_time }, { key: "n", label: "気配数", right: true, cell: (r) => String(r.quotes) },
        { key: "e", label: <>最大再現誤差<br />（bp）</>, right: true, cell: (r) => sci(r.max_abs_quote_error_bp) },
        { key: "j", label: "判定", cell: (r) => (r.max_abs_quote_error_bp < 1e-4 ? "基準内（1e-4 bp 未満）" : "基準超過") },
      ]} />
      <CheckTable caption="OISカーブの照合" checks={[
        { item: "最大再現誤差", unit: "bp", tolerance: 1e-9, pairs: d.curve_check.map((r) => [r.max_abs_quote_error_bp, refCurve(r.currency)?.max_abs_quote_error_bp as number]) },
        { item: "気配数", unit: "本", tolerance: 0, exact: true, pairs: d.curve_check.map((r) => [r.quotes, refCurve(r.currency)?.quotes as number]) },
      ]} />

      <h3>5.2 JGB：単価から計算した複利利回りと補間</h3>
      <p>
        JGB時価の単価（クリーン）と属性から、日本式の複利利回り（利払・複利とも年2回、残存年数は満年数＋端数ACT/365、小数第7位未満を切り捨て）を計算する。
        Curie は GaussQuant の <code>bond_compound_yield_from_price_YEN_GQL()</code>、このページは同じ規則を実装した rmql の
        <code>compute_compound_yield_from_price()</code> を使う。対象JPY債の複利利回りも同じ関数・同じ受渡日で計算するため、両者は比較できる。
        JGB単価の受渡日がオファーの受渡日と違う場合（例：T+1とT+2）は比較に使わない。
      </p>
      <Table caption="JGB：単価から計算した複利利回り（複利年2回）" rows={d.jgb.yields} rowKey={(r) => r.ISIN} cols={[
        { key: "n", label: "銘柄名", cell: (r) => r.security_name }, { key: "i", label: "ISIN", cell: (r) => r.ISIN },
        { key: "m", label: "償還日", cell: (r) => r.maturity_date }, { key: "s", label: "受渡日", cell: (r) => r.settlement_date },
        { key: "c", label: <>クーポン<br />（%）</>, right: true, cell: (r) => num(r.coupon_rate * 100, 2) },
        { key: "p", label: <>単価<br />（クリーン）</>, right: true, cell: (r) => num(r.clean_price, 3) },
        { key: "t", label: "残存年数", right: true, cell: (r) => num(r.remaining_years, 4) },
        { key: "y", label: <>複利利回り<br />（%）</>, right: true, cell: (r) => num(r.compound_yield_pct, 4, r.yield_message === "") },
        { key: "b", label: "備考", cell: (r) => r.yield_message || "—" },
      ]} />
      <Table caption="JGB：同一償還日の平均と、自然3次スプラインによる補間（外挿なし）"
        rows={[
          ...d.jgb.average.map((a) => ({ k: "観測点（平均）", m: a.maturity_date, s: a.settlement_date, n: String(a.n_jgbs), y: num(a.jgb_yield_pct_mean, 4), t: a.jgb_isins })),
          ...jpyOk.map((o) => ({ k: "対象債の償還日で補間", m: o.calculation_end_date ?? "—", s: o.settlement_date, n: "—", y: num(o.jgb_interpolated_yield_pct, 4), t: `${o.security_name}（${o.ISIN}）` })),
        ]}
        rowKey={(r, i) => `${r.k}${i}`} cols={[
          { key: "k", label: "区分", cell: (r) => r.k }, { key: "m", label: "償還日", cell: (r) => r.m }, { key: "s", label: "受渡日", cell: (r) => r.s },
          { key: "n", label: "銘柄数", right: true, cell: (r) => r.n }, { key: "y", label: <>JGB複利利回り<br />（%）</>, right: true, cell: (r) => r.y },
          { key: "t", label: "JGB銘柄／対象債", cell: (r) => r.t },
        ]} />
      {d.jgb.curve && (
        <LineChart title="JGB複利利回りの補間（青い点は同一償還日の平均、オレンジの点は対象債の償還日での補間値）" origin={settle}
          xMax={Math.ceil(d.jgb.curve[d.jgb.curve.length - 1].time + 0.5)} yLabel="複利利回り（%）"
          series={[
            { key: "jgb", label: "JGB（自然3次スプライン）", color: "var(--series-1)",
              points: d.jgb.curve.map((p) => ({ x: p.time, y: p.yield_pct, date: p.date })),
              dots: d.jgb.average.map((a) => ({ x: yearsFrom(settle, a.maturity_date), y: a.jgb_yield_pct_mean, date: a.maturity_date })) },
            { key: "target", label: "対象債の償還日（補間値）", color: "var(--series-2)", points: [],
              dots: jpyOk.map((o) => ({ x: yearsFrom(settle, o.calculation_end_date!), y: o.jgb_interpolated_yield_pct!, date: o.calculation_end_date! })) },
          ]}
          formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)}
          footer={<span className="muted">横軸は受渡日 {settle} からの年数（実日数/365）で、目盛りは暦年</span>} />
      )}
      <CheckTable caption="JGBの照合" checks={[
        { item: "残存年数", unit: "年", tolerance: 0, exact: true, pairs: d.jgb.yields.map((r) => [r.remaining_years, jgbRef(r.ISIN)?.remaining_years as number]) },
        { item: "JGB複利利回り", unit: "%", tolerance: 0, exact: true, pairs: d.jgb.yields.map((r) => [r.compound_yield_pct, jgbRef(r.ISIN)?.compound_yield_pct as number]) },
        { item: "同一償還日の平均", unit: "%", tolerance: 1e-12, pairs: d.jgb.average.map((a) => [a.jgb_yield_pct_mean, avgRef(a.maturity_date)?.jgb_yield_pct_mean as number]) },
      ]} />

      <h3>5.3 通貨ベーシスの平均と補間</h3>
      <p>同一の市場日・通貨ペア・契約条件・償還日の気配を算術平均し、評価日からの残存年数を横軸に自然3次スプラインで補間する。観測範囲外は外挿しない。これは <strong>ベーシス気配の補間</strong> であり、CCSカーブ全体のブートストラップではない。</p>
      <Table caption="通貨ベーシス：同一条件・同一償還日の平均と、自然3次スプラインによる補間（外挿なし）。mtm_reset は現行モデルの条件に合わないため補間に使わない"
        rows={[
          ...d.basis.table.map((b) => ({ k: "観測点（平均）", p: b.currency_pair, t: b.notional_type, m: b.maturity_date, n: String(b.n_quotes), v: num(b.basis_bp_mean, 2), s: b.quote_sources, used: b.used })),
          ...isoOk.map((o) => ({ k: "対象債の償還日で補間", p: `${o.currency}JPY`, t: "constant", m: o.calculation_end_date ?? "—", n: "—", v: num(o.basis_bp, 2), s: `${o.security_name}（${o.ISIN}）`, used: true })),
        ]}
        rowKey={(r, i) => `${r.k}${r.p}${r.t}${r.m}${i}`} cols={[
          { key: "k", label: "区分", cell: (r) => r.k }, { key: "p", label: "通貨ペア", cell: (r) => r.p }, { key: "t", label: "元本", cell: (r) => (r.used ? r.t : <span className="muted">{r.t}（使わない）</span>) },
          { key: "m", label: "償還日", cell: (r) => r.m }, { key: "n", label: "気配数", right: true, cell: (r) => r.n },
          { key: "v", label: <>ベーシス<br />（bp）</>, right: true, cell: (r) => r.v }, { key: "s", label: "気配元／対象債", cell: (r) => r.s },
        ]} />
      {d.basis.curves.map((c) => (
        <LineChart key={c.currency} title={`${c.currency}JPY ベーシス（元本一定・円担保の気配の平均と補間。オレンジの点は対象債の償還日）`} origin={d.valuation_date}
          xMax={Math.ceil(c.points[c.points.length - 1].time + 0.25)} yLabel="ベーシス（bp）"
          series={[
            { key: "b", label: "補間（自然3次スプライン）", color: "var(--series-1)", points: c.curve.map((p) => ({ x: p.time, y: p.basis_bp, date: p.date })),
              dots: c.points.map((p) => ({ x: p.time, y: p.basis_bp, date: p.maturity_date })) },
            { key: "t", label: "対象債の償還日（補間値）", color: "var(--series-2)", points: [],
              dots: isoOk.filter((o) => o.currency === c.currency).map((o) => ({ x: yearsFrom(d.valuation_date, o.calculation_end_date!), y: o.basis_bp!, date: o.calculation_end_date! })) },
          ]}
          formatY={(y) => `${y.toFixed(3)} bp`} formatTick={(y) => y.toFixed(0)} />
      ))}
      <CheckTable caption="通貨ベーシスの照合" checks={[
        { item: "同一条件・同一償還日の平均", unit: "bp", tolerance: 1e-12, pairs: d.basis.table.map((b) => [b.basis_bp_mean, d.basis.reference.find((r) => r.currency_pair === b.currency_pair && r.notional_type === b.notional_type && r.maturity_date === b.maturity_date)?.basis_bp_mean as number]) },
        { item: "対象債の償還日での補間値", unit: "bp", tolerance: 1e-6, pairs: isoOk.map((o) => [o.basis_bp, refNum(o, "basis_bp")]) },
      ]} />

      <h3>5.4 円換算ASWの残差</h3>
      <Table caption="ISO：円換算ASWの校正・フェア条件の残差（額面100当たりの取引。基準は 1e-6 未満）" rows={d.residuals} rowKey={(r) => r.offer_id} cols={[
        { key: "n", label: "銘柄名", cell: (r) => r.security_name }, { key: "i", label: "ISIN", cell: (r) => r.ISIN }, { key: "c", label: "通貨", cell: (r) => r.currency },
        { key: "f", label: <>FXスポット<br />（円/外貨1単位）</>, right: true, cell: (r) => num(r.fx_spot, 2) },
        { key: "fd", label: "FX受渡日", cell: (r) => r.fx_spot_date }, { key: "e", label: "ASW開始日", cell: (r) => r.asw_effective_date },
        { key: "z", label: <>校正した割引<br />スプレッド（bp）</>, right: true, cell: (r) => num(r.calibrated_discount_spread_bp, 2) },
        { key: "cr", label: <>CCS校正の<br />NPV残差（円）</>, right: true, cell: (r) => sci(r.ccs_residual_yen) },
        { key: "fr", label: <>フェア条件の<br />NPV残差（円）</>, right: true, cell: (r) => sci(r.fair_spread_residual_yen) },
      ]} />
      <CheckTable caption="円換算ASWの残差の照合" checks={[
        { item: "校正した割引スプレッド z", unit: "bp", tolerance: 1e-6, pairs: d.residuals.map((r) => [r.calibrated_discount_spread_bp, r.reference.calibrated_discount_spread_bp as number]) },
        { item: "CCS校正のNPV残差（基準 1e-6 円未満）", unit: "円", tolerance: 1e-6, pairs: d.residuals.map((r) => [r.ccs_residual_yen, 0]) },
        { item: "フェア条件のNPV残差（基準 1e-6 円未満）", unit: "円", tolerance: 1e-6, pairs: d.residuals.map((r) => [r.fair_spread_residual_yen, 0]) },
      ]} />
      <p className="note">原本の「元の入力ファイルを上書きしていないこと」は、R の実行前後のファイルのハッシュで確かめる節である。このページは入力を読むだけなので、2章の SHA-256 で入力の同一性を示す。</p>
    </Section>
  );
}

// 6 ----------------------------------------------------------------------------------------------------
function Limits() {
  return (
    <Section id="poc-6" title="6 未対応商品・計算条件・簡易モデルの制約">
      <h3>6.1 実装済みの機能</h3>
      <ul>
        <li>JPY／ISOの独立したワークフロー。ユーロ円債はJPY側（建て通貨で分類）</li>
        <li>オファーExcelの見出し判定と共通形式への変換（Curie の変換結果を複製して使う。元ファイル・シート・行番号を保持）</li>
        <li>ISINによる銘柄属性の結合と、Curie と同じ問題コードによる入力検証</li>
        <li>JPY OIS ASW、JGBスプレッド、自国通貨OIS ASW、円換算ASW（計算は rmql）</li>
        <li>評価日と市場日の照合（別の日付のデータで補わない）、受渡日の一致確認</li>
        <li>参考：JGB対比スプレッドで提示された気配の単価への換算（Curie にはない。3.3）</li>
      </ul>
      <h3>6.2 未対応の商品</h3>
      <table className="kv"><tbody>
        <tr><th scope="row">変動利付債</th><td>計算せず「未対応」と理由を出力。固定利付債として代用しない</td></tr>
        <tr><th scope="row">期限前償還条項付き（コーラブル等）</th><td>計算せず「未対応」と理由を出力。最終償還日とFirst Call日は別項目で保持</td></tr>
        <tr><th scope="row">満期一括償還以外、償還額100以外</th><td>現在の計算関数の対象外</td></tr>
      </tbody></table>
      <h3>6.3 計算条件（現段階の仮定を含む）</h3>
      <table className="kv"><tbody>
        <tr><th scope="row">評価日</th><td>オファー日＝各市場データの市場日。不一致・不足は別の日付で補わない</td></tr>
        <tr><th scope="row">受渡日</th><td>ASW は債券の受渡日を開始日とするため、オファー受渡日と一致した行だけ計算</td></tr>
        <tr><th scope="row">計算終期</th><td>最終償還日（固定利付・満期一括・償還額100）</td></tr>
        <tr><th scope="row">ASW翌日物レッグ</th><td>半年払い・支払ラグ0（<strong>デモの仮定</strong>）</td></tr>
        <tr><th scope="row">JGB複利利回り</th><td>クリーン単価、同じ受渡日、利払・複利とも年2回。残存年数は満年数＋端数ACT/365</td></tr>
      </tbody></table>
      <h3>6.4 円換算ASWの簡易モデルの制約</h3>
      <p>
        円換算ASWは、円担保・元本固定・開始日と満期に元本交換で、満期に対応するベーシス1点（気配を補間した値）から外貨割引の一定スプレッドを校正する簡易モデルである。
        ベーシスの補間を加えても、CCSの期間構造全体を校正したモデルではない。MtMリセット型CCS、FXスポットの受渡日とASW開始日がずれる場合のFXスワップ調整、取引費用、
        クオント調整、信用・資本・資金調達の調整は含まない。
      </p>
      <p className="muted">参考資料：<code>Coral-Book/docs/CURIE_Mockup_Overview.pdf</code>（全体像）、<code>Coral-Book/docs/asw_offer_sheet_spec.qmd</code>（ASW・オファーシートの仕様）、Curie の <code>docs/development_plan.md</code>、<code>docs/spec_differences.md</code>。</p>
    </Section>
  );
}
