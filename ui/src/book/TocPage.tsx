import { type Coverage } from "./toc";
import { CHAPTERS_LIST } from "./chapters";
import { href } from "./router";
import { Trilogy } from "./Trilogy";

const COVERAGE_CLASS: Record<Coverage, string> = { 対応: "cov-ok", 一部: "cov-part", 未対応: "cov-none", 対象外: "cov-na" };

export function TocPage() {
  return (
    <article className="prose toc">
      <h1>Carmine-Studio『エンタープライズ金融モデル』</h1>
      <p>
        無裁定価格評価モデル（イールドカーブ、OISスワップ、国債先物・CTD、オプション、CDS、キャリブレーション、金利モデル、早期償還、PRDC）とエンタープライズ計算技術（並列計算、分散計算、自動微分）を、ブラウザ上で条件を操作しながら評価・比較する Web アプリです。
      </p>
      <p>
        設計の考え方（画面・API・計算エンジンの役割分担、並列・分散計算、非同期の Web 画面）は<a href={href("/introduction")}>序論</a>にまとめています。
      </p>
      <h2>機能一覧と対応状況</h2>
      <ul className="legend-cov" aria-label="判定の凡例">
        <li><span className="cov cov-ok">対応</span>画面で条件を操作して計算できる</li>
        <li><span className="cov cov-part">一部</span>一部の計算や条件に対応</li>
        <li><span className="cov cov-none">未対応</span>今後の対応予定</li>
        <li><span className="cov cov-na">対象外</span>解説のみ、または対象外の項目</li>
      </ul>
      <div className="two-col">
        <section className="toc-chapter dashboard-card" id="toc-introduction" style={{ margin: 0 }}>
          <h3>
            序論
            <a className="toc-badge done" href={href("/introduction")}>開く</a>
          </h3>
          <p className="note">手元で動かす金融モデルを、複数の利用者がブラウザから使える形にする設計の考え方：画面・API・計算エンジンの役割分担、Rust を使う理由、並列計算と分散計算、非同期の Web 画面と金融業務の GUI。</p>
        </section>
        <section className="toc-chapter dashboard-card" id="toc-server" style={{ margin: 0 }}>
          <h3>
            サーバー接続
            <a className="toc-badge done" href={href("/server")}>開く</a>
          </h3>
          <p className="note">計算サーバー（HTTP API）との接続状態の確認、接続先 URL の切り替え、往復時間とサーバー計算時間の計測を行います。</p>
        </section>
      </div>
      <div className="two-col" style={{ marginTop: "1rem" }}>
        {CHAPTERS_LIST.map((ch) => (
          <section key={ch.id} className="toc-chapter dashboard-card" id={`toc-${ch.id}`} style={{ margin: 0, justifyContent: "flex-start" }}>
            <h3 style={{ marginTop: 0 }}>
              {ch.menu ?? ch.title}
              {ch.route ? (
                <a className="toc-badge done" href={href(ch.route)}>開く</a>
              ) : (
                <span className="toc-badge planned">計画</span>
              )}
            </h3>
            {ch.routeNote && <p className="note">{ch.routeNote}</p>}
            <h4>操作できること</h4>
            <ul>
              {ch.operations.map((op) => <li key={op}>{op}</li>)}
            </ul>
            <div className="table-wrap" style={{ margin: "0.5rem 0 0" }}>
              <table className="data">
                <caption>計算内容と対応状況</caption>
                <thead>
                  <tr>
                    <th scope="col">項目・トピック</th>
                    <th scope="col">判定</th>
                    <th scope="col">備考</th>
                  </tr>
                </thead>
                <tbody>
                  {ch.rows.map((r) => (
                    <tr key={r.topic}>
                      <th scope="row" className="wrap">{r.topic}</th>
                      <td><span className={`cov ${COVERAGE_CLASS[r.coverage]}`}>{r.coverage}</span></td>
                      <td className="wrap">{r.rmql}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <Trilogy />
    </article>
  );
}
