# 第III部の本文の移植（Coral Book から Carmine Studio へ）

- 移植日：2026-11-15（ユーザーの指示「Coral Book の Part III の日本語本文を Carmine Studio に移植する」）
- 元の原稿：Coral Book（`../Coral-Book`、旧 LagrangeFinance）の `part3_enterprise_riemann/ch01〜ch07`。原稿は Coral Book に残し、Coral Book の目次からは外した
- 移植先：`ui/src/content/enterprise/*.mdx`（ルート `#/enterprise/...`）。目次の第III部の各章から開き、各章の計算画面へのリンクをサブ項目と冒頭の注記に置いた
- 変換：`docs/port/port_part3.py`（`python docs/port/port_part3.py`。Coral Book が `../Coral-Book` にあること）。日本語本文・見出し・数式・定義・注記・参照は原文のまま。R のチャンクは静的なコードとして載せ（チャンクの設定行 `#|` は除く）、この画面では実行しない。数式とコードの外の `{` `}` `<` だけを MDX のためにエスケープした
- 確認：7 章とも目次から開き、日本語、数式（KaTeX のエラー 0、ディスプレイ数式の数は原稿の `$$` ブロックと一致）、見出し（原稿と同数）、章内のリンク（計算画面と Coral Book の原稿）を確かめた

## 章ごとの対応と、追加したい計算

| 章 | ページ | 操作できるようにしたいこと | 追加の計算 API・図表 | 実行していない R チャンク |
|---|---|---|---|---|
| 第III-1章 金融計算技術の発展 | `#/enterprise/parallel-computing`（計算：`#/parallel`） | 6 シナリオの現在価値を逐次と並列で比べ、スレッド数を変えて時間を測る | なし。計算は「並列計算」（/parallel）にあり、原稿の例と照合済み。本文の位置に、その表（6 シナリオ）と速度の図を埋め込むと読みやすい | `parallel-present-value-function`, `parallel-scenario-data`, `sequential-present-value`, `multisession-worker-plan`, `parallel-present-value`, `sequential-parallel-comparison`, `parallel-result-validation`, `sequential-plan-restore`, `parallel-benchmark-task`, `sequential-benchmark`, `parallel-benchmark`, `parallel-benchmark-summary` |
| 第III-2章 分散コンピューティング | `#/enterprise/distributed-jobs`（計算：`#/prdc-risk`、`#/server`） | タスクとジョブの表、リモート関数の呼び出し、ジョブの状態の履歴、分散データモデルの結合を、サーバーで動かして見る | 原稿のタスク・ジョブ・状態履歴・データモデルの表をそのまま返す API（例：POST /api/enterprise/distributed。R の tidyverse で原稿と同じ表を作る）<br>ジョブの状態の履歴を時系列で描く図（「PRDC のリスク計算」の実行図を流用できる） | `create-distributed-task-table`, `define-distributed-task-function`, `create-remote-request-table`, `define-remote-function`, `run-remote-function-example`, `create-job-table`, `create-job-status-history`, `create-distributed-data-model`, `join-distributed-data`, `save-distributed-data-model` |
| 第III-3章 金融計算アーキテクチャ | `#/enterprise/enterprise-computing`（計算：`#/prdc-risk`、`#/parallel`） | PRDC の取引データと市場データから、スポット×ボラティリティのシナリオ格子を並列に評価し、リスク表とスポット感応度の集計を見る | シナリオ格子（スポット・ボラ）を一括で評価し、原稿のリスク表と集計を返す API（rmql の compute_prdc_value をシナリオごとに。既存の /api/prdc-risk/job を拡張できる）<br>スポットに対する現在価値・損益の図 | `create-prdc-trade-data`, `create-prdc-market-calibration-data`, `define-prdc-scenario-pricing-function`, `create-prdc-scenario-grid`, `define-prdc-future-plan`, `calculate-prdc-scenarios-in-parallel`, `create-prdc-risk-table`, `summarize-prdc-spot-risk`, `save-prdc-risk-system-data` |
| 第III-4章 自動微分計算 | `#/enterprise/automatic-differentiation`（計算：`#/prdc-risk`） | 1 変数・多変数の関数で計算グラフを描き、自動微分の勾配を解析的な微分・有限差分と比べる | 関数と点を受け取り、値・勾配（rmql の自動微分）・解析解・中心差分を返す API<br>計算グラフ（ノードと辺）を描く図。原稿は torch の autograd、こちらは rmql の記録を表示する | `autodiff-single-variable-graph`, `autodiff-single-variable-gradient`, `autodiff-analytic-gradient`, `autodiff-multivariable-gradient` |
| 第III-5章 自動微分応用：オプション | `#/enterprise/option-greeks`（計算：`#/black-model`、`#/prdc-risk`） | オプションの価格と Greeks を解析式とモンテカルロ（共通乱数、パスごとの自動微分、ペイオフの平滑化によるガンマ）で比べる | モンテカルロのパスごとの自動微分で Delta・Vega・Gamma を返す API（rmql の P6 の自動微分グリークスを使う。平滑化の幅を入力にする）<br>解析解との差を平滑化の幅とパス数に対して描く図 | `option-market-input`, `option-gaussquant-pricing`, `option-gaussquant-greeks`, `option-mc-common-random-numbers`, `option-mc-pricing-function`, `option-mc-risk-tensors`, `option-mc-present-value`, `option-mc-first-order-greeks`, `option-smooth-payoff-function`, `option-smooth-mc-pricing-function`, `option-gamma-computational-graph`, `option-delta-for-gamma`, `option-mc-gamma`, `option-mc-greeks-summary`, `option-gaussquant-mc-comparison`, `option-mc-standard-error` |
| 第III-6章 自動微分応用：金利リスク | `#/enterprise/interest-rate-risk`（計算：`#/yield-curve-ois`、`#/deterministic-cashflow`、`#/prdc-risk`） | スワップのスケジュール・割引係数・各レグの現在価値から、自動微分の DV01 と有限差分を比べ、カーブの節点ごとの感応度（バケット DV01）を見る | スワップの現在価値と、金利・カーブ節点に対する自動微分の感応度、上下のバンプの有限差分を返す API（rmql の curve_node_sensitivity・quote_sensitivity）<br>節点ごとの DV01 の棒グラフ | `swap-market-input`, `swap-payment-schedule`, `swap-risk-tensors`, `swap-discount-factors`, `swap-fixed-leg-present-value`, `swap-floating-leg-present-value`, `swap-present-value`, `swap-autodiff-rate-gradient`, `swap-autodiff-dv01-summary`, `swap-flat-rate-pricing-function`, `swap-finite-difference-up-bump`, `swap-finite-difference-down-bump`, `yield-curve-node-data`, `yield-curve-risk-tensors`, `yield-curve-cash-flows`, `yield-curve-present-value`, `yield-curve-autodiff-gradient`, `yield-curve-bucketed-dv01`, `yield-curve-gps`, `yield-curve-total-dv01` |
| 第III-7章 自動微分応用：多因子モデル | `#/enterprise/prdc`（計算：`#/prdc-risk`、`#/prdc`） | PRDC の現在価値と FX デルタ・ベガ、円・外貨カーブの DV01 を自動微分で一度に求め、有限差分と比べる | なし。計算は「PRDC のリスク計算」（/prdc-risk）にあり、原稿の torch の結果と標本誤差の範囲で照合済み | `prdc-market-input`, `prdc-jpy-foreign-curves`, `prdc-mc-common-random-numbers`, `prdc-market-risk-tensors`, `prdc-contract-tensors`, `prdc-mc-pricing-function`, `prdc-mc-present-value`, `prdc-autodiff-risk-gradient`, `prdc-fx-delta`, `prdc-jpy-curve-dv01`, `prdc-foreign-curve-dv01`, `prdc-fx-vega`, `prdc-fx-vega01`, `prdc-risk-summary`, `prdc-curve-risk-summary`, `prdc-finite-difference-fx-delta` |

今回は本文の移植を優先し、上の API と図表は作っていない。作るときは、原稿のチャンクと同じ入力で rmql の結果を照合し、`server/tests/reconciliation/` に記録する。

## 3 章への再編（2026-11-15）

ユーザーの指示で、移植した 7 章を「 9. 並列計算」「10. 分散計算」「11. 自動微分」の 3 章にまとめ、全体を 1〜11 の通し番号にした（序論は番号なし）。

| 章 | 本文（Coral Book） | 組み込んだ計算画面 | 旧 URL |
|---|---|---|---|
|  9. 並列計算（`#/enterprise/parallel-computing`） | III-1（III-1.7 を除く） | 6 シナリオの表、債券の一括評価の測定（`#measure`）、PRDC のモンテカルロのスレッド比較（`#threads`） | `#/parallel` → `#measure` |
| 10. 分散計算（`#/enterprise/distributed-jobs`） | III-2、III-3（`#enterprise-computing`） | シナリオをジョブに分けて送る（`#jobs`） | `#/enterprise/enterprise-computing` |
| 11. 自動微分（`#/enterprise/automatic-differentiation`） | III-1.7（導入）、III-4、III-5（`#option-greeks`）、III-6（`#interest-rate-risk`）、III-7（`#prdc`） | PRDC と市場の入力、パスごとの自動微分、自動微分と Bump & Revalue（`#ad-vs-bump`） | `#/enterprise/option-greeks`、`#/enterprise/interest-rate-risk`、`#/enterprise/prdc`、`#/prdc-risk` |

- 各章は `docs/port/merge_part3.py` が Coral Book の原稿から作る（本文の変換は `port_part3.py` の `convert`）。計算画面に添えた説明文は旧ページのもの（`docs/port/former/`）。
- 重複する導入：第III-1章の III-1.7「自動微分」は「11. 自動微分」の導入に移し、「 9. 並列計算」からは外した。旧「PRDC のリスク計算」ページの冒頭（第III部全体の要約）は、章の構成と重なるので使わず、その「まとめ」は「11. 自動微分」の末尾に置いた。
- PRDC の評価（Coral Book II-9、`#/prdc`）は、「11. 自動微分」の下のページにした。
- 章番号は `ui/src/book/chapters.ts`（並びと旧 URL の行き先）と `ui/src/book/ChapterNo.tsx`（半角 3 文字分の番号欄）。
