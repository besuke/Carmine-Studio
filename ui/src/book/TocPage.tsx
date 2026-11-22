import { CHAPTERS_LIST } from "./chapters";
import { GROUPS } from "./groups";
import { href } from "./router";

// The top page: a launcher over the four groups of the side menu (screen name, one line, open).
export function TocPage() {
  return (
    <article className="prose toc">
      <h1>Carmine-Studio</h1>
      <p className="lead">エンタープライズ金融モデル：条件を動かして、評価・感応度・リスクを確かめるワークベンチ。</p>
      {GROUPS.map((g) => (
        <section key={g.title} className="launch-group" aria-label={g.title}>
          <h2>{g.title}</h2>
          <div className="launcher">
            {g.items.map(({ route, blurb, label }) => {
              const ch = CHAPTERS_LIST.find((c) => c.route === route);
              return (
                <a key={route} className="launch-card" href={href(route)} data-testid="launch-card">
                  <span className="launch-name">{label ?? ch?.menu ?? ch?.title ?? route}</span>
                  <span className="launch-blurb">{blurb}</span>
                  <span className="launch-open">開く →</span>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </article>
  );
}
