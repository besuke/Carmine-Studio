import YieldCurveOis from "./content/yield-curve-ois.mdx";
import YieldCurves from "./content/yield-curves.mdx";
import JgbFutures from "./content/jgb-futures.mdx";
import CreditCds from "./content/credit-cds.mdx";
import BlackModel from "./content/black-model.mdx";
import DeterministicCashflow from "./content/deterministic-cashflow.mdx";
import IrsCalibration from "./content/irs-calibration.mdx";
import RateModels from "./content/rate-models.mdx";
import EarlyRedemption from "./content/early-redemption.mdx";
import Prdc from "./content/prdc.mdx";
import Introduction from "./content/introduction.mdx";
// Coral-Book's Part III, gathered into chapters 9, 10 and 13 (scripts/port/merge_part3.py); chapters 11 and 12 are Carmine-Studio's own
import ParallelComputing from "./content/chapters/parallel-computing.mdx";
import DistributedComputing from "./content/chapters/distributed-computing.mdx";
import AutomaticDifferentiation from "./content/chapters/automatic-differentiation.mdx";
import CnnFundamentals from "./content/chapters/cnn-fundamentals.mdx";
import CnnApplications from "./content/chapters/cnn-applications.mdx";
import { CurveProvider } from "./components/curves";
import { CHAPTERS_LIST, ROUTE_ALIASES } from "./book/chapters";
import { useEffect, useState } from "react";
import { TocPage } from "./book/TocPage";
import { href, useRoute } from "./book/router";
import { ScenarioProvider } from "./state/ScenarioContext";
import { AswDetailPage, AswListPage } from "./asw/pages";
import { AswPocPage } from "./asw/poc";
import { ServerConnectionProvider, ServerIndicator, ServerPage } from "./server/connection";
import { Icon } from "./components/icons";

const CHAPTERS: Record<string, () => React.ReactNode> = {
  "/enterprise/parallel-computing": () => (
    <article className="prose ported">
      <ParallelComputing />
    </article>
  ),
  "/enterprise/distributed-jobs": () => (
    <article className="prose ported">
      <DistributedComputing />
    </article>
  ),
  "/enterprise/cnn-fundamentals": () => (
    <article className="prose ported">
      <CnnFundamentals />
    </article>
  ),
  "/enterprise/cnn-applications": () => (
    <article className="prose ported">
      <CnnApplications />
    </article>
  ),
  "/enterprise/automatic-differentiation": () => (
    <article className="prose ported">
      <AutomaticDifferentiation />
    </article>
  ),
  "/introduction": () => (
    <article className="prose">
      <Introduction />
    </article>
  ),
  "/prdc": () => (
    <article className="prose">
      <Prdc />
    </article>
  ),
  "/early-redemption": () => (
    <article className="prose">
      <EarlyRedemption />
    </article>
  ),
  "/rate-models": () => (
    <article className="prose">
      <RateModels />
    </article>
  ),
  "/irs-calibration": () => (
    <article className="prose">
      <IrsCalibration />
    </article>
  ),
  "/deterministic-cashflow": () => (
    <article className="prose">
      <DeterministicCashflow />
    </article>
  ),
  "/black-model": () => (
    <article className="prose">
      <BlackModel />
    </article>
  ),
  "/credit-cds": () => (
    <article className="prose">
      <CreditCds />
    </article>
  ),
  "/jgb-futures": () => (
    <article className="prose">
      <JgbFutures />
    </article>
  ),
  "/yield-curves": () => (
    <CurveProvider>
      <article className="prose">
        <YieldCurves />
      </article>
    </CurveProvider>
  ),
  "/yield-curve-ois": () => (
    <ScenarioProvider>
      <article className="prose">
        <YieldCurveOis />
      </article>
    </ScenarioProvider>
  ),
};

function Sidebar({
  route,
  collapsed,
  onToggle,
}: {
  route: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="ナビゲーション">
      <div className="sidebar-top">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggle}
          title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
          aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        >
          <Icon name={collapsed ? "expand" : "collapse"} />
          {!collapsed && <span className="sidebar-toggle-label">折りたたむ</span>}
        </button>
      </div>
      <a href={href("/")} className={route === "/" ? "active" : undefined} title="目次と対応状況">
        <Icon name="contents" />
        <span className="sidebar-label">目次</span>
      </a>
      <a href={href("/server")} className={route === "/server" ? "active" : undefined} title="rmql Compute Server との接続">
        <Icon name="server" />
        <span className="sidebar-label">サーバー接続</span>
      </a>
      <div className="sidebar-part">機能</div>
      <ul className="chapter-list">
        <li>
          <a href={href("/introduction")} className={route === "/introduction" ? "active" : undefined} title="序論">
            <Icon name="book" />
            <span className="sidebar-label">序論</span>
          </a>
        </li>
        {CHAPTERS_LIST.map((ch) => (
          <li key={ch.id}>
            <a
              href={href(ch.route!)}
              className={route === ch.route ? "active" : undefined}
              title={ch.menu ?? ch.title}
            >
              <Icon name={ch.icon} />
              <span className="sidebar-label">{ch.menu ?? ch.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Scrolls to a section once the page is drawn (old URLs of pages gathered into a chapter). */
function ScrollTo({ anchor }: { anchor: string }) {
  useEffect(() => {
    const t = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView(), 50);
    return () => window.clearTimeout(t);
  }, [anchor]);
  return null;
}

export function App() {
  const raw = useRoute();
  const alias = ROUTE_ALIASES[raw];
  const route = alias ? alias.route : raw;
  const chapter = CHAPTERS[route];
  const aswId = /^\/asw\/([A-Za-z0-9_-]+)$/.exec(route)?.[1];
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("carmine-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("carmine-sidebar-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <ServerConnectionProvider>
      <header className="site-header">
        <a className="brand" href={href("/")} title="Carmine-Studio">
          <span className="brand-text">
            <span className="brand-name">Carmine-Studio</span>
            <span className="brand-sub">エンタープライズ金融モデル</span>
          </span>
        </a>
        <ServerIndicator />
      </header>
      <div className={`layout ${collapsed ? "sidebar-collapsed" : ""}`}>
        <Sidebar route={route} collapsed={collapsed} onToggle={toggleCollapsed} />
        <main className="page">
          {alias && <ScrollTo anchor={alias.anchor} />}
          {chapter ? chapter() : route === "/" ? <TocPage /> : route === "/server" ? <ServerPage /> : route === "/asw" ? <AswListPage /> : route === "/asw/poc" ? <AswPocPage /> : aswId ? <AswDetailPage offerId={aswId} /> : (
            <p>ページが見つかりません。<a href={href("/")}>目次へ</a></p>
          )}
        </main>
      </div>
    </ServerConnectionProvider>
  );
}
