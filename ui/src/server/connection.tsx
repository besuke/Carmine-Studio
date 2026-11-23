import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { fetchServerInfo, type ServerInfo } from "../api/server";
import { LineChart, type SeriesPoint } from "../components/LineChart";
import { href } from "../book/router";

// The connection to the calculation server (R + rmql, server/server.R). One provider for the whole
// page: the header shows the state everywhere, and the connection page shows the details and the history.

const HISTORY = 60;

interface Check {
  n: number;
  at: Date;
  ok: boolean;
  roundTripMs: number | null;
  serverMs: number | null;
  error?: string;
}

interface ConnectionState {
  info: ServerInfo | null;
  last: Check | null;
  history: Check[];
  checking: boolean;
  intervalSec: number;
  auto: boolean;
  setAuto: (on: boolean) => void;
  setIntervalSec: (s: number) => void;
  checkNow: () => void;
}

const Ctx = createContext<ConnectionState | null>(null);

export function ServerConnectionProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [history, setHistory] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);
  const [auto, setAuto] = useState(true);
  const [intervalSec, setIntervalSec] = useState(10);
  const counter = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const checkNow = useCallback(() => {
    inFlight.current?.abort();
    const c = new AbortController();
    inFlight.current = c;
    const n = ++counter.current;
    setChecking(true);
    // the R server answers one request at a time: a long calculation of another page can hold this check for a while
    const timeout = window.setTimeout(() => c.abort(), 20000);
    fetchServerInfo({ signal: c.signal })
      .then((r) => {
        setInfo(r.info);
        setHistory((h) => [...h, { n, at: r.checkedAt, ok: true, roundTripMs: r.roundTripMs, serverMs: 1000 * r.info.probe.seconds_each * r.info.probe.repeats }].slice(-HISTORY));
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError" && inFlight.current !== c) return; // replaced by a newer check
        const error = e instanceof ApiError ? e.message : e instanceof DOMException && e.name === "AbortError" ? "20 秒以内に応答がありません。" : String(e);
        setHistory((h) => [...h, { n, at: new Date(), ok: false, roundTripMs: null, serverMs: null, error }].slice(-HISTORY));
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (inFlight.current === c) setChecking(false);
      });
  }, []);

  useEffect(() => {
    checkNow();
  }, [checkNow]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(checkNow, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [auto, intervalSec, checkNow]);

  const last = history.length ? history[history.length - 1] : null;
  return (
    <Ctx.Provider value={{ info, last, history, checking, auto, setAuto, intervalSec, setIntervalSec, checkNow }}>
      {children}
    </Ctx.Provider>
  );
}

function useConnection(): ConnectionState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useConnection must be used inside ServerConnectionProvider");
  return s;
}

type Status = "connected" | "disconnected" | "connecting";
function statusOf(s: ConnectionState): Status {
  if (!s.last) return "connecting";
  return s.last.ok ? "connected" : "disconnected";
}
const STATUS_LABEL: Record<Status, string> = { connected: "接続中", disconnected: "未接続", connecting: "確認中" };
const STATUS_ICON: Record<Status, string> = { connected: "●", disconnected: "×", connecting: "…" };

/** The header's indicator: the state in words and an icon, linking to the connection page. */
export function ServerIndicator() {
  const s = useConnection();
  const st = statusOf(s);
  return (
    <a className={`server-indicator server-${st}`} href={href("/server")} aria-live="polite"
      title={s.last?.ok ? `往復 ${s.last.roundTripMs?.toFixed(0)} ms` : s.last?.error ?? "確認中"}>
      <span aria-hidden="true">{STATUS_ICON[st]}</span> rmql Compute Server：{STATUS_LABEL[st]}
    </a>
  );
}

const ms = (x: number | null | undefined, digits = 1) => (x == null ? "—" : `${x.toFixed(digits)} ms`);
const time = (d: Date) => d.toLocaleTimeString("ja-JP", { hour12: false });
function duration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h} 時間 ${m} 分` : m ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

function StatusPanel() {
  const s = useConnection();
  const st = statusOf(s);
  const ok = s.last?.ok;
  const recent = s.history.filter((c) => c.ok).slice(-10);
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const v = [...xs].sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  return (
    <section className={`server-status server-${st}`} aria-labelledby="server-status-h">
      <h2 id="server-status-h"><span aria-hidden="true">{STATUS_ICON[st]}</span> {STATUS_LABEL[st]}</h2>
      {st === "disconnected" && (
        <div className="banner error" role="alert">
          <strong>rmql Compute Server に接続できません。</strong> {s.last?.error}
          <div className="banner-cmd">起動のしかた：プロジェクトのフォルダーで <code>npm run api</code>、またはプロジェクトの <code>CarmineStudio.ps1</code>（デスクトップのショートカット「Carmine-Studio」）で「1」。サーバーは <code>127.0.0.1:8787</code> で待ち受ける。</div>
        </div>
      )}
      <dl className="server-facts">
        <div><dt>最後の確認</dt><dd>{s.last ? `${time(s.last.at)}（#${s.last.n}）` : "—"}</dd></div>
        <div><dt>往復の時間（ブラウザで計測）</dt><dd>{ok ? ms(s.last?.roundTripMs) : "—"}</dd></div>
        <div><dt>サーバー内の計算時間（{s.info?.probe.repeats ?? 20} 回分）</dt><dd>{ok ? ms(s.last?.serverMs, 2) : "—"}</dd></div>
        <div><dt>直近 {recent.length} 回の往復の中央値</dt><dd>{ms(median(recent.map((c) => c.roundTripMs as number)))}</dd></div>
        <div><dt>確認の成功</dt><dd>{s.history.filter((c) => c.ok).length} / {s.history.length} 回</dd></div>
      </dl>
      <div className="controls server-controls">
        <button type="button" onClick={s.checkNow} disabled={s.checking}>{s.checking ? "確認中…" : "今すぐ接続を確認"}</button>
        <label><input type="checkbox" checked={s.auto} onChange={(e) => s.setAuto(e.target.checked)} /> 自動で確認する</label>
        <label>間隔
          <select value={s.intervalSec} onChange={(e) => s.setIntervalSec(Number(e.target.value))} disabled={!s.auto}>
            {[5, 10, 30, 60].map((v) => <option key={v} value={v}>{v} 秒</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

function HistoryChart() {
  const { history } = useConnection();
  const okChecks = history.filter((c) => c.ok);
  if (okChecks.length < 2) return <p className="muted">接続の確認が 2 回以上成功すると、時間の推移を描く。</p>;
  const first = history[0].n;
  const pt = (c: Check, y: number): SeriesPoint => ({ x: c.n - first, y, date: `#${c.n} ${time(c.at)}` });
  const rt = okChecks.map((c) => pt(c, c.roundTripMs as number));
  const sv = okChecks.map((c) => pt(c, c.serverMs as number));
  const last = history[history.length - 1].n - first;
  const step = Math.max(1, Math.ceil(last / 6));
  const ticks = Array.from({ length: Math.floor(last / step) + 1 }, (_, k) => ({ x: k * step, label: `#${first + k * step}` }));
  const failed = history.filter((c) => !c.ok);
  return (
    <LineChart title={`接続の確認ごとの時間（直近 ${history.length} 回）`} origin="2026-01-01" xMin={0} xMax={Math.max(1, last)} xTicks={ticks}
      xLabel="確認の番号" yLabel="ミリ秒"
      series={[
        { key: "rt", label: "往復の時間", color: "var(--series-1)", points: rt, dots: rt.length <= 30 ? rt : undefined },
        { key: "sv", label: "サーバー内の計算時間", color: "var(--series-2)", points: sv },
      ]}
      markers={failed.map((c) => ({ x: c.n - first, label: "未接続" }))}
      formatY={(y) => `${y.toFixed(1)} ms`} formatTick={(y) => y.toFixed(0)} />
  );
}

function ServerFacts() {
  const { info } = useConnection();
  if (!info) return <p className="muted">サーバーから情報を受け取ると表示する。</p>;
  const rows: [string, ReactNode][] = [
    ["計算エンジン", `${info.engine.name} ${info.engine.version}`],
    ["R", `${info.runtime.r_version}（${info.runtime.platform}）`],
    ["待ち受け", `${info.listen.host}:${info.listen.port}${info.listen.lan ? "（社内LANのすべてのインターフェース）" : "（このPCだけ）"}`],
    ["画面の配信", info.listen.serves_page ? "rmql Compute Server が画面も配信（npm run lan）" : "画面は開発サーバー（Vite）から。/api だけ rmql Compute Server へ転送"],
    ["起動した時刻", `${info.started_at}（稼働 ${duration(info.uptime_seconds)}）`],
    ["受け付けた要求", `${info.requests_served.toLocaleString("ja-JP")} 件（起動から）`],
    ["論理プロセッサ", `${info.runtime.logical_processors}`],
    ["プロセス番号", `${info.runtime.pid}`],
    ["パッケージの場所", <code key="lib">{info.engine.library}</code>],
    ["疎通の計算", `${info.probe.calculation}、1 回 ${(1e6 * info.probe.seconds_each).toFixed(1)} µs（検算値 ${info.probe.check_value.toPrecision(8)}）`],
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>rmql Compute Server の情報（<code>GET /api/server</code>、応答 <code>{info.response.request_id}</code>）</caption>
        <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="wrap">{v}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function RouteTable() {
  const { info } = useConnection();
  if (!info) return null;
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>rmql Compute Server が受け付ける API（{info.routes.length} 本）</caption>
        <thead><tr><th scope="col">方法</th><th scope="col">パス</th><th scope="col">使うページ</th></tr></thead>
        <tbody>{info.routes.map((r) => <tr key={`${r.method} ${r.path}`}><td>{r.method}</td><td><code>{r.path}</code></td><td className="wrap">{r.page}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CheckLog() {
  const { history } = useConnection();
  const rows = history.slice(-10).reverse();
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>直近の確認（新しい順、最大 10 回）</caption>
        <thead><tr><th scope="col">番号</th><th scope="col">時刻</th><th scope="col">結果</th><th scope="col" className="num">往復</th><th scope="col" className="num">サーバー内</th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.n}><td>#{c.n}</td><td>{time(c.at)}</td>
            <td className={c.ok ? "cov-ok" : "error-text"}>{c.ok ? "● 応答あり" : `× ${c.error ?? "応答なし"}`}</td>
            <td className="num">{ms(c.roundTripMs)}</td><td className="num">{ms(c.serverMs, 2)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** The addresses other people use: the configured host name (DNS) or this server's LAN addresses, never 127.0.0.1. */
function PublicUrls() {
  const { info } = useConnection();
  if (!info?.public) return null;
  const p = info.public;
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>
          利用者が開くアドレス（{p.source === "config" ? "設定 carmine.config.json の publicHost" : p.source === "env" ? "環境変数 CARMINE_PUBLIC_HOST" : "このサーバーの LAN の IP アドレス"}）
          {p.serving ? "" : "：社内LANで公開するのは CarmineStudio.ps1 の「2」（npm run lan）で起動したときである"}
        </caption>
        <tbody>{p.urls.map((u, i) => (
          <tr key={u}><th scope="row">{i === 0 ? "案内する URL" : "ほかの LAN アドレス"}</th><td><a href={u} data-testid={i === 0 ? "public-url" : undefined}>{u}</a></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** The connection page. */
export function ServerPage() {
  return (
    <article className="prose">
      <h1>rmql Compute Server との接続</h1>
      <StatusPanel />
      <PublicUrls />
      <h2>時間の推移</h2>
      <p>
        往復の時間は、ブラウザが要求を送ってから応答を受け取るまでである。サーバー内の計算時間は、サーバーが rmql の小さな計算を
        決まった回数くり返した時間で、往復との差はおもに通信と JSON の変換である。
      </p>
      <HistoryChart />
      <CheckLog />
      <h2>サーバーの情報</h2>
      <p>
        各章の計算は、すべて rmql Compute Server（R の HTTP API、<code>server/server.R</code>）が <strong>rmql</strong> で行う。画面は
        <code> /api</code> に要求を送り、返ってきた JSON を表とグラフにする。
      </p>
      <ServerFacts />
      <RouteTable />
    </article>
  );
}
