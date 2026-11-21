import { TOC, type Chapter } from "./toc";
import type { IconName } from "../components/icons";

// The chapters as the reader sees them: the introduction (no number), then one numbered list, 1 to 13.
// Chapters 1 to 8 are Coral Book's II-1 to II-8. Coral Book's Part III is gathered into three chapters: 9 parallel
// computing (III-1), 10 distributed computing (III-2, III-3), two chapters of Carmine Studio's own on convolutional
// networks (11, 12: no source in Coral Book) and 13 automatic differentiation (III-1.7, III-4 to III-7). The PRDC page
// (Coral Book II-9) is part of chapter 13 (exotic autodiff), accessible from its top link.
// Coral Book's numbers stay as the sources (ids, the contents page's references, each page's note).

export interface NumberedChapter extends Chapter {
  no: number;
  icon: IconName;
  /** Coral Book's chapters the text comes from, e.g. ["III-4", "III-5"]. */
  sourceIds: string[];
  sources: string[];
}

const CHAPTER_ICONS: Record<number, IconName> = {
  1: "cashflow",
  2: "curve",
  3: "swap",
  4: "bell",
  5: "shield",
  6: "sliders",
  7: "paths",
  8: "callback",
  9: "parallel",
  10: "network",
  11: "convolution",
  12: "surrogate",
  13: "derivative",
};

const all = new Map(TOC.flatMap((p) => p.chapters).map((c) => [c.id, c]));

function merge(no: number, title: string, route: string, ids: string[], routeNote: string, subRoutes?: Chapter["subRoutes"]): NumberedChapter {
  const parts = ids.map((id) => all.get(id)!);
  return {
    no,
    icon: CHAPTER_ICONS[no],
    id: ids.length === 1 ? ids[0] : `${ids[0]}〜${ids[ids.length - 1]}`,
    title,
    menu: title,
    route,
    subRoutes,
    routeNote,
    source: parts[0].source,
    sources: parts.map((c) => c.source),
    sourceIds: ids,
    operations: parts.flatMap((c) => c.operations),
    rows: parts.flatMap((c) => c.rows.map((r) => ({ ...r, sections: r.sections }))),
    additions: [...new Set(parts.flatMap((c) => c.additions))],
  };
}

export const CHAPTERS_LIST: NumberedChapter[] = [
  ...TOC[0].chapters.filter((c) => c.id !== "II-9").map((c, i) => {
    const no = i + 1;
    return { ...c, no, icon: CHAPTER_ICONS[no], sourceIds: [c.id], sources: [c.source] };
  }),
  merge(9, "並列計算", "/enterprise/parallel-computing", ["III-1"],
    "債券の一括評価の測定や、モンテカルロ・シミュレーションのスレッド数を変えて並列計算の効果を測定・操作できます"),
  merge(10, "分散計算", "/enterprise/distributed-jobs", ["III-2", "III-3"],
    "シナリオ格子をジョブに分割して計算サーバーへ送り、集約する分散計算の流れを操作できます"),
  merge(11, "CNN の基礎と実践", "/enterprise/cnn-fundamentals", ["CNN-1"],
    "畳み込みのフォワードとバックワードの式から、国債カーブの翌月予測（1D-CNN とランダムウォーク・リッジ回帰の比較）と、予測したカーブでの債券の損益を rmql で評価するところまでを操作できます"),
  merge(12, "CNN の金融モデル応用", "/enterprise/cnn-applications", ["CNN-2"],
    "Hull–White、MBS、CLO・CDO のトランシェを CNN で近似する場合の設計と、自動微分との比較を解説します（画面での計算はありません）"),
  merge(13, "エキゾチック自動微分", "/enterprise/automatic-differentiation", ["III-4", "III-5", "III-6", "III-7", "II-9"],
    "PRDCの高次元リスク感応度を自動微分（AAD）で一度に求め、有限差分と比べる計算や、パスごとの自動微分モンテカルロを操作できます。PRDCの評価は章の冒頭リンクから操作できます"),
];

/** Old URLs of the gathered pages, and where they lead now: the chapter's route and a section id. */
export const ROUTE_ALIASES: Record<string, { route: string; anchor: string }> = {
  "/parallel": { route: "/enterprise/parallel-computing", anchor: "measure" },
  "/enterprise/enterprise-computing": { route: "/enterprise/distributed-jobs", anchor: "enterprise-computing" },
  "/enterprise/option-greeks": { route: "/enterprise/automatic-differentiation", anchor: "option-greeks" },
  "/enterprise/interest-rate-risk": { route: "/enterprise/automatic-differentiation", anchor: "interest-rate-risk" },
  "/enterprise/prdc": { route: "/enterprise/automatic-differentiation", anchor: "prdc" },
  "/prdc-risk": { route: "/enterprise/automatic-differentiation", anchor: "prdc" },
};
