"""Gather Coral Book's Part III into three chapters of Carmine Studio: 9 並列計算, 10 分散計算, 11 自動微分.

The text comes from Coral Book's manuscripts through port_part3.convert (the Japanese text, headings, math,
definitions and notes as written; R code as static blocks). The computations that can be operated (the former pages
#/parallel and #/prdc-risk) are placed in the sections they belong to, with the explanations they had there.

    python docs/port/merge_part3.py     (Coral Book in ../Coral-Book)

Writes ui/src/content/chapters/{parallel-computing,distributed-computing,automatic-differentiation}.mdx.
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from port_part3 import SRC, convert  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "ui", "src", "content", "chapters")
REPO = "https://github.com/besuke/Coral-Book/blob/main/part3_enterprise_riemann"
FILES = {
    "III-1": "ch01_computational_evolution_parallel.qmd", "III-2": "ch02_distributed_computing_jobtask.qmd",
    "III-3": "ch03_enterprise_financial_computing.qmd", "III-4": "ch04_automatic_differentiation.qmd",
    "III-5": "ch05_option_greeks_autodiff.qmd", "III-6": "ch06_interest_rate_risk_autodiff.qmd", "III-7": "ch07_prdc_autodiff.qmd",
}


def source(cid):
    title, body, _ = convert(io.open(os.path.join(SRC, FILES[cid]), encoding="utf-8").read())
    return re.sub(r"^第III-\d+章\s*", "", title), body.strip("\n").split("\n")


def heading_level(line):
    m = re.match(r"^(#{1,6}) ", line)
    return len(m.group(1)) if m else 0


def scan(lines):
    """Index of each line, with a flag for lines inside code fences."""
    inside = False
    for i, l in enumerate(lines):
        if l.strip().startswith("```"):
            inside = not inside
            yield i, True
            continue
        yield i, inside


def demote(lines):
    out = list(lines)
    for i, inside in scan(lines):
        if not inside and heading_level(lines[i]):
            out[i] = "#" + lines[i]
    return out


def find(lines, prefix):
    for i, inside in scan(lines):
        if not inside and lines[i].startswith(prefix):
            return i
    raise SystemExit(f"heading not found: {prefix}")


def insert_before(lines, prefix, block):
    i = find(lines, prefix)
    return lines[:i] + block + [""] + lines[i:]


def cut_from(lines, prefix):
    i = find(lines, prefix)
    return lines[:i], lines[i:]


def prdc_risk_sections():
    """The explanations and components of the former page #/prdc-risk, by its section titles."""
    text = io.open(os.path.join(ROOT, "docs", "port", "former", "prdc-risk.mdx"), encoding="utf-8").read().replace("\r\n", "\n")
    parts = re.split(r"^## (.+)$", text, flags=re.M)
    return {parts[i].strip(): parts[i + 1].strip("\n").split("\n") for i in range(1, len(parts), 2)}


def parallel_section(title):
    text = io.open(os.path.join(ROOT, "docs", "port", "former", "parallel.mdx"), encoding="utf-8").read().replace("\r\n", "\n")
    parts = re.split(r"^## (.+)$", text, flags=re.M)
    sections = {parts[i].strip(): parts[i + 1].strip("\n").split("\n") for i in range(1, len(parts), 2)}
    return [l for l in sections[title] if l.strip() != "</ParallelProvider>"]


def clean(block):
    return [l for l in block if l.strip() not in ("</PrdcRiskProvider>",)]


def server_block(level, anchor, title, body):
    tag = f"h{level}"
    head = f'<{tag} id="{anchor}">{title}</{tag}>' if anchor else "#" * level + " " + title
    return [head, ""] + clean(body)


def note(sources, extra):
    links = "、".join(f"[第{cid}章「{t}」]({REPO}/{FILES[cid]})" for cid, t in sources)
    return [f"> この章の本文は、Coral Book『金融工学の応用基礎』第III部の {links} の原稿を移したものです（見出し・数式・定義・注記は原文のまま）。"
            f"R のコードは原稿のものを載せていますが、この画面では実行しないので、表や数値の出力は表示されません。{extra}", ""]


def section_head(anchor, title, cid):
    return [f'<h2 id="{anchor}">{title}</h2>', "", f"出典：Coral Book 第{cid}章「{title}」", ""]


def write(name, text):
    os.makedirs(OUT, exist_ok=True)
    io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n").write(text.rstrip("\n") + "\n")
    print(f"wrote chapters/{name} ({text.count(chr(10))} lines)")


def main():
    pr = prdc_risk_sections()
    t1, b1 = source("III-1")

    # 9 並列計算: III-1 without III-1.7 (it opens chapter 11); the measurements in III-1.4 to III-1.6
    b10, towards_ad = cut_from(b1, "## III-1.7")
    b10 = insert_before(b10, "## III-1.5", ["<ExampleTable />"])
    b10 = insert_before(b10, "## III-1.6", server_block(3, "measure", "R サーバーで確かめる：債券の一括評価", parallel_section("III-1.5 並列計算を測る")))
    b10 += [""] + server_block(3, "threads", "R サーバーで確かめる：PRDC のモンテカルロをスレッドで分ける", pr["並列計算（III-1）"])
    ch10 = ["import { ParallelProvider, ParallelStatus, ExampleTable, BatchControls, TimingPanel, BatchResultChart } from \"../../components/parallel\";",
            "import { PrdcRiskProvider, RiskControls, ThreadsPanel } from \"../../components/prdcRisk\";",
            "import { ChapterNo } from \"../../book/ChapterNo\";", "", "<ParallelProvider>", "<PrdcRiskProvider>", "",
            "# <ChapterNo n={9} />並列計算", ""] + note([("III-1", t1)], "銘柄ごとの評価やシナリオ計算を分けて同時に動かす計算は、各節の「R サーバーで確かめる」で条件を変えて確かめられます。") \
        + ["<ParallelStatus />", ""] + b10 + ["", "</PrdcRiskProvider>", "</ParallelProvider>"]
    write("parallel-computing.mdx", "\n".join(ch10))

    # 10 分散計算: III-2 and III-3; the jobs in III-2.4
    t2, b2 = source("III-2")
    t3, b3 = source("III-3")
    b2 = demote(b2)
    b2 = insert_before(b2, "### III-2.5", server_block(4, "jobs", "R サーバーで確かめる：ジョブを送って集約する", pr["分散計算：ジョブを送って集約する（III-2〜III-3）"]))
    ch11 = ["import { PrdcRiskProvider, PrdcRiskStatus, DistributedPanel } from \"../../components/prdcRisk\";",
            "import { ChapterNo } from \"../../book/ChapterNo\";", "", "<PrdcRiskProvider>", "",
            "# <ChapterNo n={10} />分散計算", "",
            "本章では、金融計算をジョブに分け、結果を集約する構成を扱う。実演では、ブラウザから単一のR APIに計算を送る。複数ノードへの分配と Slurm での実行は今後の拡張である（序論）。", "",
            "> 出典：Coral Book『金融工学の応用基礎』" + "、".join(f"[第{cid}章「{t}」]({REPO}/{FILES[cid]})" for cid, t in (("III-2", t2), ("III-3", t3)))
            + "。R のコードは原稿のものを静的に載せ、この画面では実行しない。", ""] \
        + ["<PrdcRiskStatus />", ""] + section_head("distributed-jobs", t2, "III-2") + b2 + [""] \
        + section_head("enterprise-computing", t3, "III-3") + demote(b3) + ["", "</PrdcRiskProvider>"]
    write("distributed-computing.mdx", "\n".join(ch11))

    # 11 自動微分: III-1.7 as the opening, III-4 to III-7; PRDC's market, Monte Carlo and AD in III-7.1 to III-7.3
    srcs = {cid: source(cid) for cid in ("III-4", "III-5", "III-6", "III-7")}
    opening = [l for l in towards_ad[1:]]  # III-1.7 without its heading
    b7 = demote(srcs["III-7"][1])
    b7 = insert_before(b7, "### III-7.2", server_block(4, None, "R サーバーで確かめる：PRDC と市場の入力", pr["PRDC と市場の入力（III-7.1）"]))
    b7 = insert_before(b7, "### III-7.3", server_block(4, None, "R サーバーで確かめる：パスごとの自動微分", pr["モンテカルロとパスごとの自動微分（III-5、III-7.2）"]))
    b7 = insert_before(b7, "### III-7.4", server_block(4, "ad-vs-bump", "R サーバーで確かめる：自動微分と Bump & Revalue", pr["自動微分と Bump & Revalue（III-1.3、III-4〜III-7）"]))
    anchors = {"III-4": "automatic-differentiation-basics", "III-5": "option-greeks", "III-6": "interest-rate-risk"}
    body12 = []
    for cid in ("III-4", "III-5", "III-6"):
        body12 += section_head(anchors[cid], srcs[cid][0], cid) + demote(srcs[cid][1]) + [""]
    body12 += section_head("prdc", srcs["III-7"][0], "III-7") + b7 + [""] + server_block(2, "summary", "まとめ", pr["まとめ"])
    ch12 = ["import { PrdcRiskProvider, PrdcRiskStatus, RiskControls, NotePanel, AdPanel, McPanel } from \"../../components/prdcRisk\";",
            "import { ChapterNo } from \"../../book/ChapterNo\";", "", "<PrdcRiskProvider>", "",
            "# <ChapterNo n={11} />自動微分", ""] \
        + note([("III-1", t1)] + [(cid, srcs[cid][0]) for cid in ("III-4", "III-5", "III-6", "III-7")],
               "冒頭の導入は第III-1章の III-1.7 です。オプションの価格と Greeks は「 4. ブラックモデル」、スワップの時価と気配の感応度は「 3. OISスワップ」、PRDC の評価そのもの（Coral Book II-9）はこの章の下の「PRDC」のページで操作できます。") \
        + ["<PrdcRiskStatus />", ""] + opening + [""] + body12 + ["", "</PrdcRiskProvider>"]
    write("automatic-differentiation.mdx", "\n".join(ch12))


if __name__ == "__main__":
    main()
