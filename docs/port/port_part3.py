"""Port Coral Book's Part III (part3_enterprise_riemann/*.qmd) to Carmine Studio's MDX pages.

The Japanese text, headings, math, definitions, notes and references are kept as written. R chunks become static
code blocks (their options #| are dropped; the page does not run them). Outside code and math, the characters MDX
reads as JSX ({, }, <) are escaped. Each page opens with a note that links Coral Book's source and the
computation pages of Carmine Studio for the chapter.
"""
import io
import os
import re

SRC = r"C:\AnalyticFin\Projects\Coral-Book\part3_enterprise_riemann"
DST = r"C:\AnalyticFin\Projects\Carmine-Studio\ui\src\content\enterprise"
REPO = "https://github.com/besuke/Coral-Book/blob/main/part3_enterprise_riemann"

CHAPTERS = [
    ("ch01_computational_evolution_parallel.qmd", "parallel-computing", [("並列計算", "/parallel")]),
    ("ch02_distributed_computing_jobtask.qmd", "distributed-jobs", [("PRDC のリスク計算（分散ジョブ）", "/prdc-risk"), ("計算サーバーとの接続", "/server")]),
    ("ch03_enterprise_financial_computing.qmd", "enterprise-computing", [("PRDC のリスク計算", "/prdc-risk"), ("並列計算", "/parallel")]),
    ("ch04_automatic_differentiation.qmd", "automatic-differentiation", [("PRDC のリスク計算（自動微分と Bump & Revalue）", "/prdc-risk")]),
    ("ch05_option_greeks_autodiff.qmd", "option-greeks", [("ブラックモデル", "/black-model"), ("PRDC のリスク計算", "/prdc-risk")]),
    ("ch06_interest_rate_risk_autodiff.qmd", "interest-rate-risk", [("イールドカーブと円OIS", "/yield-curve-ois"), ("確定キャッシュフロー（BPV）", "/deterministic-cashflow"), ("PRDC のリスク計算（カーブ節点の感応度）", "/prdc-risk")]),
    ("ch07_prdc_autodiff.qmd", "prdc", [("PRDC のリスク計算", "/prdc-risk"), ("PRDC", "/prdc")]),
]

INLINE = re.compile(r"(`[^`]*`|\$[^$\n]+\$)")


def escape_text(segment):
    return segment.replace("{", "\\{").replace("}", "\\}").replace("<", "&lt;")


def escape_line(line):
    parts = INLINE.split(line)
    return "".join(p if i % 2 == 1 else escape_text(p) for i, p in enumerate(parts))


def convert(text):
    lines = text.replace("\r\n", "\n").split("\n")
    title = None
    i = 0
    if lines and lines[0].strip() == "---":
        j = lines.index("---", 1)
        for l in lines[1:j]:
            m = re.match(r'title:\s*"(.*)"', l)
            if m:
                title = m.group(1)
        i = j + 1
    out = []
    in_code = False
    code_is_r = False
    in_math = False
    chunks = []
    for l in lines[i:]:
        s = l.strip()
        if in_code:
            if s.startswith("```"):
                in_code = False
                out.append("```")
                continue
            if code_is_r and s.startswith("#|"):
                m = re.match(r"#\|\s*label:\s*(\S+)", s)
                if m:
                    chunks.append(m.group(1))
                continue
            out.append(l)
            continue
        if s.startswith("```"):
            in_code = True
            m = re.match(r"```\{(\w+)[^}]*\}", s)
            code_is_r = bool(m)
            out.append("```" + (m.group(1) if m else s[3:]))
            continue
        if in_math:
            out.append(l)
            if s.endswith("$$"):
                in_math = False
            continue
        if s.startswith("$$"):
            out.append(l)
            if not (len(s) > 2 and s.endswith("$$")):
                in_math = True
            continue
        out.append(escape_line(l))
    return title, "\n".join(out).strip("\n") + "\n", chunks


def main():
    os.makedirs(DST, exist_ok=True)
    report = []
    for n, (src, slug, pages) in enumerate(CHAPTERS, start=1):
        text = io.open(os.path.join(SRC, src), encoding="utf-8").read()
        title, body, chunks = convert(text)
        links = "、".join(f"[{name}](#{route})" for name, route in pages)
        head = f"""# {title}

> この章は、Coral Book『金融工学の応用基礎』第III部の原稿 [`part3_enterprise_riemann/{src}`]({REPO}/{src}) の本文を移したものです（見出し・数式・定義・注記は原文のまま）。R のコードは原稿のものを載せていますが、この画面では実行しないので、表や数値の出力は表示されません。この章の計算は {links} で、条件を変えながら R サーバー（rmql）で確かめられます。

"""
        io.open(os.path.join(DST, f"{slug}.mdx"), "w", encoding="utf-8", newline="\n").write(head + body)
        report.append((n, title, slug, src, len(body.splitlines()), chunks))
        print(f"III-{n} {title} -> enterprise/{slug}.mdx ({len(body.splitlines())} lines, {len(chunks)} R chunks)")
    return report


if __name__ == "__main__":
    main()
