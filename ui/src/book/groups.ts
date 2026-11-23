import type { IconName } from "../components/icons";

// The four groups of the side menu and of the launcher on the top page: only screens where something can be computed or
// moved. Explanation-only pages (/introduction, /enterprise/cnn-applications) keep their URLs but are not listed.
export interface Launch {
  route: string;
  blurb: string;
  /** For screens that are not in book/chapters.ts (the PRDC page is part of chapter 14 there). */
  label?: string;
  icon?: IconName;
}
export interface Group {
  title: string;
  items: Launch[];
}

export const GROUPS: Group[] = [
  {
    title: "金利カーブ・債券",
    items: [
      { route: "/deterministic-cashflow", blurb: "キャッシュフロー、利回り・単価、デュレーション・BPV、Z スプレッド" },
      { route: "/yield-curves", blurb: "ゼロ金利ノードと補間、平行シフト、国債先物・CTD" },
      { route: "/yield-curve-ois", blurb: "円 TONA の OIS カーブと 7 年 OIS スワップの評価損益" },
      { route: "/credit-cds", blurb: "ハザードレート、CDS の NPV・フェアスプレッド・アップフロント" },
    ],
  },
  {
    title: "株・オプション・CB",
    items: [
      { route: "/black-model", blurb: "Black 76・BSM、モンテカルロ、アメリカン・オプション" },
      { route: "/enterprise/lookback-convertible", blurb: "ルックバック、転換社債、MSCB の価値とグリークス" },
    ],
  },
  {
    title: "金利モデル・仕組み債",
    items: [
      { route: "/irs-calibration", blurb: "Normal・Black ボラ、SABR、Hull–White、BGM のキャリブレーション" },
      { route: "/rate-models", blurb: "Hull–White の短期金利経路、LMM キャップレット" },
      { route: "/early-redemption", blurb: "コール債の行使判断、MBS のプリペイメントと OAS" },
      { route: "/prdc", label: "PRDC", icon: "paths", blurb: "PRDC の現在価値、FX 感応度、期待クーポン" },
      { route: "/enterprise/mbs-prdc", blurb: "MBS の元本残高と OAS、TARN・ノックアウト" },
    ],
  },
  {
    title: "計算基盤・ML・自動微分",
    items: [
      { route: "/enterprise/parallel-computing", blurb: "スレッド数を変えて並列計算の効果を測る" },
      { route: "/enterprise/distributed-jobs", blurb: "シナリオをジョブに分けて送り、集約する" },
      { route: "/enterprise/cnn-fundamentals", blurb: "CNN による JGB カーブの予測、ブラック・ショールズ価格の学習" },
      { route: "/enterprise/automatic-differentiation", blurb: "PRDC の感応度を自動微分と有限差分で比べる" },
    ],
  },
];
