import type { ReactNode } from "react";
import { href } from "./router";

export const CORAL_BOOK_REPO = "https://github.com/besuke/coral-book";
export const CRIMSON_PROOF_REPO = "https://github.com/besuke/Crimson";
export const CARMINE_STUDIO_REPO = "https://github.com/besuke/Carmine-Studio";

export const coralChapter = (source: string) => `${CORAL_BOOK_REPO}/blob/main/${source}`;
const crimsonChapter = (file: string) => `${CRIMSON_PROOF_REPO}/blob/main/${file}`;

const Ext = ({ to, children }: { to: string; children: ReactNode }) => (
  <a href={to} target="_blank" rel="noreferrer">{children}</a>
);
const Page = ({ route, children }: { route: string; children: ReactNode }) => <a href={href(route)}>{children}</a>;

interface Theme {
  theme: string;
  coral: ReactNode;
  carmine: ReactNode;
  crimson: ReactNode;
}

const P2 = "part2_quantive_riemann";
const THEMES: Theme[] = [
  {
    theme: "割引と無裁定",
    coral: <><Ext to={coralChapter(`${P2}/ch01_deterministic_cashflow.qmd`)}>確定キャッシュフロー</Ext>、<Ext to={coralChapter(`${P2}/ch03_ois_swaps_multicurve.qmd`)}>OISスワップ</Ext>で割引と複製を計算する</>,
    carmine: <><Page route="/yield-curve-ois">OISスワップ</Page>で気配を動かしてスワップの時価を確かめる。<Page route="/asw">OISアセットスワップ</Page></>,
    crimson: <><Ext to={crimsonChapter("ch10_finite_market.qmd")}>有限市場の無裁定</Ext>、<Ext to={crimsonChapter("ch11_numeraire.qmd")}>ニューメレール</Ext>、<Ext to={crimsonChapter("ch12_ftap.qmd")}>資産価格の基本定理</Ext>で無裁定の仮定を定義して証明する</>,
  },
  {
    theme: "金利カーブ",
    coral: <Ext to={coralChapter(`${P2}/ch02_interest_rate_curves.qmd`)}>金利カーブ</Ext>,
    carmine: <><Page route="/yield-curves">金利カーブ・CTD</Page>、<Page route="/jgb-futures">国債先物・CTD</Page></>,
    crimson: <Ext to={crimsonChapter("ch11_numeraire.qmd")}>ニューメレール</Ext>,
  },
  {
    theme: "オプション",
    coral: <Ext to={coralChapter(`${P2}/ch04_black_model.qmd`)}>ブラックモデル</Ext>,
    carmine: <Page route="/black-model">ブラックモデル</Page>,
    crimson: "—",
  },
  {
    theme: "信用リスク",
    coral: <Ext to={coralChapter(`${P2}/ch05_credit_risk_cds.qmd`)}>信用リスクとCDS</Ext>,
    carmine: <Page route="/credit-cds">信用リスクとCDS</Page>,
    crimson: "—",
  },
  {
    theme: "PRDC",
    coral: <Ext to={coralChapter(`${P2}/ch09_exotic_derivatives_prdc.qmd`)}>金利為替系デリバティブ（PRDC）</Ext>,
    carmine: <><Page route="/prdc">PRDC</Page>、<Page route="/enterprise/automatic-differentiation">エキゾチック自動微分</Page></>,
    crimson: <Ext to={crimsonChapter("lean/LagrangeAcademy/PrdcCoupon.lean")}>クーポンの分解（Lean）</Ext>,
  },
  {
    theme: "並列・分散・自動微分",
    coral: <Ext to={`${CORAL_BOOK_REPO}/tree/main/part3_enterprise_riemann`}>エンタープライズ計算</Ext>,
    carmine: <><Page route="/enterprise/parallel-computing">並列計算</Page>、<Page route="/enterprise/distributed-jobs">分散計算</Page>、<Page route="/enterprise/automatic-differentiation">エキゾチック自動微分</Page></>,
    crimson: "—",
  },
];

export function Trilogy() {
  return (
    <section aria-labelledby="trilogy-h" className="trilogy">
      <h2 id="trilogy-h">関連プロジェクトとの位置づけ</h2>
      <p>
        金融モデルを「手元で計算する（Coral-Book）」「Webアプリでインタラクティブに動かす（Carmine-Studio）」「仮定から定理を形式証明する（Crimson Proof）」の三つの視点から整理しています。
      </p>
      <div className="two-col">
        <div className="table-wrap">
          <table className="data">
            <caption>三つのアプローチ</caption>
            <thead>
              <tr><th scope="col">プロジェクト</th><th scope="col">アプローチ</th><th scope="col">リポジトリ</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Coral-Book『金融工学の応用基礎』</th>
                <td className="wrap">理論と数式を読み、手元のコードで計算を再現する</td>
                <td><Ext to={CORAL_BOOK_REPO}>besuke/coral-book</Ext></td>
              </tr>
              <tr>
                <th scope="row">Carmine-Studio『エンタープライズ金融モデル』</th>
                <td className="wrap">ブラウザから条件を操作し、計算サーバーでモデルとリスクを評価する</td>
                <td><Ext to={CARMINE_STUDIO_REPO}>besuke/Carmine-Studio</Ext></td>
              </tr>
              <tr>
                <th scope="row">Crimson Proof『Leanから見た金融数学』</th>
                <td className="wrap">金融モデルの仮定を Lean で定義し、成り立つ定理を形式証明する</td>
                <td><Ext to={CRIMSON_PROOF_REPO}>besuke/Crimson</Ext></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="data">
            <caption>テーマ別の対応</caption>
            <thead>
              <tr><th scope="col">テーマ</th><th scope="col">Coral-Book</th><th scope="col">Carmine-Studio</th><th scope="col">Crimson Proof</th></tr>
            </thead>
            <tbody>
              {THEMES.map((t) => (
                <tr key={t.theme}>
                  <th scope="row">{t.theme}</th>
                  <td className="wrap">{t.coral}</td>
                  <td className="wrap">{t.carmine}</td>
                  <td className="wrap">{t.crimson}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
