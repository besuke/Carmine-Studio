# 各章の初期値と Coral-Book の R 実行例の対応

- 確認日：2026-11-25（rmql 0.5.0、`ui/src/content/*.mdx` と `ui/tests/guides.test.ts` の時点）
- 目的：各章の「この章の使い方」と画面の初期値が、Coral-Book の R 実行チャンクの入力に由来するかを一覧にする。
- 方法：原稿（`Coral-Book/part2_quantive_riemann/ch0N_*.qmd`、`part3_enterprise_riemann/`）の R チャンクを読み、入力の行とチャンク名を記録した。API の既定値は `ui/tests/guides.test.ts` が毎回、使い方の文章と照合する。数値の一致は、各章の照合記録（`*/RECONCILIATION_*.md`）と `server/tests/golden/` の基準値で確かめている。

## 1. 原稿の R 例と同じ初期値の章

| 章 | 画面の初期値 | 原稿の位置（ファイル：行、チャンク名） | 備考 |
|---|---|---|---|
| II-1 | 40年債（7.5%、単利 6.515%、Zスプレッド 50bp） | ch01 `bond-basic-setup`、`yen-bond-simple-price` | `bond.guide.test.ts` が単価・複利利回り・BPV を基準値と照合 |
| II-2 カーブ | ゼロ金利 0D 0.05%〜10Y 1.15%、評価日 2022-08-19 | ch02:493 `zero-rate-nodes` | |
| II-2 カーブ | 平行シフト 50 bp | ch02:1050 `parallel-curve-shift` | |
| II-2 先物 | Funding Rate 1.23%、受渡日 2026-12-20 | ch02:1310〜1312 `jgb-deliverable-basket` | 現物・先物価格は教材用の架空値 |
| II-4 | Black 76：フォワード 107 + 6.75/32、ボラ 5.2% | ch04:117〜119 `black-inputs` | |
| II-4 | モンテカルロ：200 パス、seed 1 | ch04:393 `pseudo-monte-carlo` | |
| II-4 | BSM：取引日 2024-03-01 ほか | ch04:248 `bsm-inputs` | |
| II-4 | Longstaff–Schwartz：2,048 パス | ch04:731 `longstaff-schwartz` | |
| II-5 | フラット：Recovery 0.40、評価日 2022-09-19 | ch05:168〜177 `flat-inputs` | |
| II-5 | 標準 CDS：市場 Spread 30.426 bp | ch05:725 `credit-sensitivity` | |
| II-6 | SABR・Normal：フォワード 0.56% | ch06:149 | |
| II-6 | Hull–White：a 8%、σ 1.2% | ch06:353 | 説明用の合成データ |
| II-6 | BGM：相関の減衰 0.45 | ch06:514 | |
| II-7 | Hull–White：a 12%、σ 1%、初期曲線 2% | ch07:133 | |
| II-7 | キャップレット：行使金利 2.75% | ch07:277 | |
| II-7 | 相関 0.8 / 0.5 / 0.7 | ch07:313 | |
| II-8 | Hull–White：a 15%、σ 1.2% | ch08:372 | |
| II-8 | MBS：PSA 100% | ch08:542 | |
| II-9 | FX スポット 133.2681 円 | ch09:79 `product-inputs` | |
| II-9 | 乱数の種 123 | ch09:90 `product-inputs` | |
| 15（Part III 第4〜7章） | FX スポット 150、ボラ 12%、20,000 パス、seed 1234 | part3 ch07:324〜357 | |

## 2. 原稿の例と異なる初期値

| 章 | 画面の初期値 | 原稿 | 理由と扱い |
|---|---|---|---|
| II-9 | モンテカルロ 3,000 パス | 現在価値 300 パス、感応度 100 パス（ch09:88〜89） | 原稿は QuantLib の乱数による少ないパス数。rmql は乱数列が異なるので、標本誤差を読める本数にした。`RECONCILIATION_PRDC.md` に記載済み |

## 3. 原稿に R 例がない（Studio の画面で足したもの）

| 章 | 内容 | 根拠 |
|---|---|---|
| II-3 | 円 TONA・7年 OIS（固定払い、想定元本 100 億円）と「5年クォート＋1 bp」で PV 差を見る操作例。2026-09-10 のサンプル気配（`bluegamma_tonar_quotes_GQL()`）を使用 | Studio の操作例として採用（決定済み）。原稿の II-3 は 2022-08-19 の TONA クォート、短期 OIS（想定元本 10,000,000）、EONIA の ±10bp シナリオ。計算は GaussQuant に同じ入力を渡して照合済み（`RECONCILIATION.md`） |
| II-2 | 1ノードだけ動かすシミュレーション（10Y、+100 bp） | 原稿は平行シフトのみ。ノードを変えて `/api/curves/zero` でカーブを作り直した結果で、照合記録（`RECONCILIATION_CURVES.md`）はノードの再現（II-2.5.3）まで。この1ノードの変化の照合は未実施 |
| 9 | 債券の一括評価 10,000 件、スレッド数 1〜16 の測定 | 原稿の `furrr` 例は 6 シナリオと 12 タスク。測定は `RECONCILIATION_PARALLEL.md` |
| 10 | 45 シナリオのジョブ分割 | 原稿 III-2 の考え方を、`/api/prdc-risk/job` で実行 |
| 11・12 | CNN による国債カーブ予測、ブラック・ショールズ価格の学習 | Studio の独自の章（`docs/cnn_chapters_spec.md`、`RECONCILIATION_BS_SURROGATE.md`） |
| 13・14 | ルックバック・転換社債・MSCB、MBS・TARN | Studio の独自の章（`RECONCILIATION_P16.md`、`RECONCILIATION_MBS_PRDC.md`） |

## 4. II-3 の扱い（決定）

現行の 7年 OIS を Studio の操作例として採用する。使い方は「Studioの操作例。2026-09-10のサンプル気配を使用。円TONA・7年、想定元本100億円、固定払い。」と書き、操作は「5年クォート＋1 bp を選び、PV 差を確認する」に絞った。原稿の例（2022-08-19 のクォート、EONIA の ±10bp シナリオ）に合わせる案は採らない。
