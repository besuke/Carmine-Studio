# 第 11.5・13・14・15 章の統合設計書（案）

【設計案。2026-11-22。コードと MDX にはまだ触れていない。この文書の確認後に、実装の順序（9 章）に従って進める】

## 0. 前提と制約

- 役割分担は `CLAUDE.md` のとおり：画面（`ui/src/`）は表示だけ、API（`server/`）は入力の検査と rmql の呼び出し、計算は rmql。**画面で金融の計算をしない。**
- API の流儀（既存の API と同じ）：POST で JSON、不正な入力は HTTP 400 と日本語のメッセージ、応答に `response.request_id` と `computed_at`。回帰テストは `ui/tests/*.api.test.ts`（Vitest、API を 8788 で起動）。
- **新しい計算は、独立な計算と照合し、`server/tests/reconciliation/` に記録してから画面に出す。** この設計書では、照合の基準を、各章に書く（QuantLib 1.42、閉じた式、数値積分）。
- 第 11・12 章（CNN）と同じく、第 13・14 章は、Coral-Book に対応する章がない Carmine-Studio の独自の章として扱う（`toc.ts` の `source` は「Carmine-Studio の独自の章」）。Coral-Book への理論部分の抽出は、別途の指示があるまで行わない。`Coral-Book`・`GaussQuant`・`Curie` は変更しない。
- rmql は **0.5.0**（P16 のルックバック、転換社債、MSCB を含む）に上げ、この PC の既定のライブラリーに入れた（2026-11-22）。`server/server.R` は、`rmql` 0.5.0 以上を要求する。GitHub の Release と gh-pages への公開は、後で判断する。

## 1. 貫く問い

> 明日からの価値を計算するために、今日までの何を覚えておけばいいか（持ち越す状態）

| 章 | 商品 | 覚えておくもの | 計算の形 |
|---|---|---|---|
| 11.5 | ヨーロピアン | なし（株価と行使価格の比 $S/K$ だけで足りる） | 解析解。学習で近似する |
| 13 | ルックバック | 監視日の最小値 $m$（最大値 $M$） | $z = S/m$ の 1 次元に縮約 |
| 13 | 転換社債（CB） | なし（株価だけ） | 1 次元の格子 |
| 13 | 転換時リセットの MSCB | なし（転換のときの株価で決まる） | 1 次元の格子 |
| 13 | 転換価額を持ち越す MSCB | 現在の転換価額 $K$ | $(S, K)$ の 2 次元。限度がなければ $z = S/K$ の 1 次元 |
| 14 | MBS | 元本残高、金利の履歴（借り換えの機会を逃した債務者の残り） | 縮約できない。経路を生成する |
| 14 | PRDC（TARN、ノックアウト） | 累積クーポン、生存しているか | 縮約できない。多因子のモンテカルロ |
| 15 | 同じ PRDC の感応度 | — | 計算グラフのバックワード（自動微分） |

各章の最初に、この表の該当する行を示し、章の最後に「次の章で何を持ち越すか」を 1 文で書く。

## 2. 章番号と URL

| 章 | 題 | URL | MDX | 状態 |
|---|---|---|---|---|
| 11 | CNN の基礎と実践 | `#/enterprise/cnn-fundamentals` | `cnn-fundamentals.mdx` | 既存。**11.5 を差し替える**（3 章） |
| 12 | CNN の金融モデル応用 | `#/enterprise/cnn-applications` | `cnn-applications.mdx` | 既存。章番号の参照だけ直す |
| **13** | ルックバック・転換社債・MSCB | `#/enterprise/lookback-convertible` | `lookback-convertible.mdx` | **新設** |
| **14** | MBS・PRDC | `#/enterprise/mbs-prdc` | `mbs-prdc.mdx` | **新設** |
| **15** | エキゾチック自動微分 | `#/enterprise/automatic-differentiation`（**変えない**） | `automatic-differentiation.mdx` | 既存。13 から繰り下げる |

既存の URL（`ROUTE_ALIASES`、`#/enterprise/automatic-differentiation`、`#/prdc`、`#/early-redemption`）は変えない。

## 3. 第 11.5 章：ヨーロピアンの価格関数の学習

現在の 11.5 は、ボラティリティ曲面への応用の解説（計算なし）。これを、**答えの分かっている価格関数を学習し、解析解と比べる**節に替える（曲面の解説は、短く残して 12 章へ回すか、1 段落にする）。

- **狙い**：第 11.4 は、答えの分からない未来（翌月の金利）の予測だった。ここでは、答え（ブラック・ショールズの解析解）があるので、学習した関数の誤差を、真の値と直接比べられる。学習の限界（学習範囲の外）と、微分（バックワード）の精度も、解析解のグリークスと比べられる。
- **モデル**：入力は、価格は $S$ と $K$ について 1 次同次なので、$(\ln(S/K),\ T,\ \sigma,\ r,\ q)$ の 5 個、出力は $C/K$。入力が格子の構造を持たないスカラーなので、畳み込みではなく**全結合（MLP）**が自然（11.1 の「構造がないときは畳み込みを使う理由がない」の実例になる）。2D 格子（満期×ストライクの曲面）を CNN で扱う案は、曲面のデータの用意が要るので、この版では見送る（確定）。
- **オフライン**（`server/scripts/cnn/train_bs_surrogate.R`）：`rmql::compute_european_option_value()` で教師データを作り（解析解なので速い）、11.3 の式（フォワード、バックワード、数値勾配チェック）で MLP を学習する。シード固定。結果を `server/data/cnn/bs_surrogate_results.json`（重み、学習曲線、誤差の格子、学習範囲の内と外の誤差の表）に保存する。
- **ライブ API**：`POST /api/cnn/bs-surrogate`（入力：現物、行使価格、金利、配当、ボラティリティ、満期）→ 学習済みネットワークの値（R で、保存した重みからフォワード）、rmql の厳密な値、誤差、ネットワークのデルタ（バックワード）と rmql のデルタ。範囲外なら、警告を返す。0.01 秒以下の見込み（未確認）。
- **照合**：基準は rmql の `compute_european_option_value()`（QuantLib 1.42 と相対 1e-12 で照合済み）。ネットワークは近似なので、誤差の大きさを記録する（一致は求めない）。
- **次への持ち越し**：学習した関数の微分は近似になる。13・15 章で、微分を、計算そのものから厳密に求める。
- **実装の記録（2026-11-22）**：`server/scripts/cnn/train_bs_surrogate.R`（5-32-32-1、tanh、Adam 全データ、6,000 エポック、学習 599 秒）→ `server/data/cnn/bs_surrogate_results.json`。API は `POST /api/cnn/bs-surrogate`（範囲外は警告つきで返す）と `GET /api/cnn/bs-summary`（重みを除く保存結果）。照合は `server/tests/reconciliation/cnn_bs/`（`npm run reconcile:bs-surrogate`、7 項目）：誤差そのものは「結果」で、照合するのは仕組み（教師の閉じた式、フォワード、バックワードと数値微分、デルタ、同次性、新しい点の誤差が学習時の記録と同じ大きさ）。範囲内の誤差（K=1 の単位）：価格の RMSE 3.3e-3、最大 2.3e-2。デルタの RMSE 4.7e-2、最大 3.0e-1（価格より約 14 倍悪い）。

## 4. 第 13 章：ルックバック・転換社債・MSCB

### 4.1 節の構成

| 節 | 内容 | rmql の関数 | ライブ | 事前計算 |
|---|---|---|---|---|
| 13.1 | 状態の問い。ヨーロピアンの $S/K$ から、ルックバックの $m$、MSCB の $K$ へ | `compute_european_option_value` | 表の説明のみ | — |
| 13.2 | ルックバック：連続監視の閉じた式と、離散監視の木 | `compute_lookback_option_value`、`compute_discrete_lookback_option_value` | 1 点の値とグリークス | 収束（段数 100〜6400）、モンテカルロとの比較 |
| 13.3 | 固定転換価額の CB：価値と転換確率の格子 | `compute_convertible_bond_value` | 1 点の値とグリークス | 価値—株価の曲線（既定の債券） |
| 13.4 | 転換時にリセットする MSCB：転換価値の頭打ち | `compute_reset_convertible_bond_value` | 1 点 | 閉じた式との比較表 |
| 13.5 | 転換価額を持ち越す MSCB：2 次元と 1 次元の縮約 | `compute_carried_reset_convertible_bond_value` | 縮約（グリークスつき）、格子（値だけ） | 格子の収束、速さの比、格子のグリークス |

### 4.2 ライブ API

- `POST /api/lookback`：`lookbackType`、`optionType`、`spot`、`runningExtremum`、`strike`、金利、配当、ボラティリティ、満期、`monitoringCount`（等間隔の監視回数、0 なら連続）、`steps`。連続の値とグリークス、離散の値とグリークスを返す。
- `POST /api/convertible`：債券の条件（残存年数、クーポン、額面、償還額）、`conversion`（`fixed` または `reset`）、転換比率、または `priceRatio`・`lowerPrice`・`upperPrice`、行使方式、コールとプットの表、信用スプレッド、市場の入力、`steps`。値、グリークス、（Stage 3 では）転換価値の形を返す。
- `POST /api/mscb`（Stage 4）：`resetDates`、`rule`、`method`（`scaled` または `grid`）、`priceNodes`、`greeks`。
- `GET /api/lookback-convertible/summary`：事前計算の JSON（収束、速さの比、曲線）。
- 債券は、R の側で、`rmql::create_fixed_rate_bond()` を、半年クーポンの固定利付債として作る（既存の債券の API と同じ作り方）。

### 4.3 事前計算 JSON

`server/data/p16/`（`server/scripts/p16/*.R` が作る）：

| ファイル | 内容 |
|---|---|
| `lookback_convergence.json` | 離散監視の木の値と、連続監視の閉じた式との差（段数 100・400・1600・6400、コール・プット）。月次 12 回の独立なモンテカルロとの比較 |
| `convertible_curve.json` | 既定の債券の価値、デルタ、転換確率の、株価に対する曲線（コールの有無） |
| `mscb_reset_closed_form.json` | 転換時リセットの価値と、ヨーロピアンの閉じた式の比較表（$\alpha$、下限、上限、段数） |
| `mscb_carried_grid.json` | 格子の点数（20〜160）と、縮約との差、速さの比、グリークスつきの格子の値 |

`rmql` の版、実行日、この PC の仕様、シードを、各 JSON に記録する（速さの値は環境で変わる）。

### 4.4 照合（`server/tests/reconciliation/p16/`）

| 計算 | 基準 | 備考 |
|---|---|---|
| 連続監視のルックバック | QuantLib 1.42（`AnalyticContinuousFloating/FixedLookbackEngine`）、固定ストライクと浮動ストライクの恒等式 | rmql の照合（400 行）と同じ基準 |
| 離散監視のルックバック | 連続監視への収束、独立なモンテカルロ | R の QuantLib に離散のエンジンはない |
| CB | QuantLib 1.42（`BinomialCRRConvertibleEngine`）、割引率 $r + s$ の普通債の極限、閉じた式（スプレッド 0・クーポンなし・ヨーロピアン） | rmql の 300 行と同じ基準 |
| 転換時リセットの MSCB | 閉じた式、固定比率の CB との一致（上限と下限が等しい） | |
| 持ち越しの MSCB | 閉じた式（`Both`、ヨーロピアン）、数値積分（`DownwardOnly`）、格子と縮約の相互の一致 | |

**画面での QuantLib との違いの扱い**：アメリカン型の満期での転換は、QuantLib と違うことがある（rmql は満期でも転換できる）。`CLAUDE.md` の「原稿と rmql の違いを前面に出さない」に従い、本文には出さず、照合の記録に書く。

### 4.5 画面（`ui/src/components/lookback/`、`convertible/`、`mscb/`）

- ルックバック：入力のスライダー、連続と離散の価値、段数に対する誤差の図（事前計算）。
- CB：債券と市場の入力、価値—株価の曲線、グリークス、転換確率の説明。
- MSCB（転換時）：$\alpha$ のスライダーで、転換価値の形（下限・割引・上限）の図と、頭打ち（$F/\alpha$）で即時に転換するときの価値の表示。**即時転換の性質を、本文で説明する**（rmql の仕様書 5 章）。
- MSCB（持ち越し）：リセット日の指定、規則（`both`/`downward_only`）、方法の切替（縮約・格子）、転換価額の履歴の図（株価のシナリオを下落・横ばい・上昇から選び、R の側で、リセットの式を適用して返す）。

## 5. 第 14 章：MBS・PRDC

縮約できない経路依存（元本残高、累積クーポン）を、経路ごとに持ち越して評価する章。

| 節 | 内容 | rmql の関数 | ライブ | 事前計算 |
|---|---|---|---|---|
| 14.1 | 状態の問い：残高、累積クーポン、生存 | — | — | — |
| 14.2 | MBS：期限前返済と、残高の経路 | `create_mbs_pass_through`、`compute_mbs_cashflows`、`compute_mbs_path_values`、`generate_hull_white_monthly_rates` | 金利のシナリオ別の残高と CPR の経路 | — |
| 14.3 | MBS の OAS：経路の数と精度 | `compute_mbs_oas` | 200 経路の OAS | 経路数 200〜20000 の収束 |
| 14.4 | PRDC：クーポンの状態（TARN、ノックアウト） | `compute_prdc_three_factor_value`（`target`、`knock_out_level`、`knock_out_dates`） | 2 万経路の価値と、終了する時期の分布 | 20 万経路以上の分布と、収束 |

- 既存の部品の再利用：MBS は第 8 章（早期償還、`/api/callable`）で既に使っている。PRDC は `#/prdc`（`/api/prdc`）と `#/enterprise/automatic-differentiation`（`/api/prdc-risk`）で使っている。この章は、新しい画面というより、**状態の見方で、既存の計算を並べ直す章**で、新しい API は最小にする（`POST /api/mbs/state`、`POST /api/prdc/tarn` の 2 本の案）。
- **PRDC の頁の居場所**（確定）：`#/prdc` は、14 章の下（**14.1 PRDC**）に移す。URL `#/prdc` は変えない。現在は「13.1 PRDC」として旧 13 章（自動微分）の下にある（`toc.ts` の `II-9` を、`merge` で自動微分の章に束ねている）ので、`II-9` を 14 章の `merge` に移し、15 章は、同じ PRDC の感応度から始める。README の表も変わる。
- 照合：MBS は、rmql の `mbs` の照合（独立な実装と閉じた形）を引き継ぎ、画面の値が、`compute_mbs_path_values` の値と一致することを、テストで確かめる。PRDC は、既存の `server/tests/reconciliation/prdc/` を引き継ぐ。TARN は、`target = Inf` のときに、TARN なしの値と一致することを確かめる。

## 6. 第 15 章：エキゾチック自動微分

- 既存の本文と画面は、そのまま使う。変更は、章番号（13 → 15）、導入（**14 章の PRDC を継続の題材**として始める）、11.3 とのつながり（手で導いたバックワードを自動化する）、11.5 とのつながり（学習した関数の微分と、厳密な自動微分の比較）、13 章のグリークスと自動微分の関係の一言（**すべてが自動微分ではない**。下の訂正を参照）。
- 新しい計算も、新しい検証の画面も、足さない（確定）。13 章のグリークスと自動微分の関係を、導入で述べるだけにする。
- **訂正（2026-11-22）**：「13 章のグリークスはすべて自動微分」は事実と違う。自動微分は、ベガ・ロー・配当ロー・信用スプレッドの感応度、ルックバックの行使価格・最小値の感応度。木の商品のデルタとガンマは、格子の最初の 1〜2 段から（Hull の式）、ルックバックのガンマは時刻 0 の格子の 2 階差分（rmql の `spec_lookback_convertible.md`）。**ユーザーの指示により、自動微分は 13 章に「紹介」の小節として入れた**（13.1 の末尾「この章のグリークスの求め方：自動微分の紹介」。15 章の導入にも、同じ区別を書いた）。

## 7. ライブ API と事前計算の切り分け

**基準**：既定の入力で、この PC（R 4.6、windows-gnu、2026-11-22 の実測）で、**0.3 秒以下**ならライブ。超える、または、収束の研究・速さの比・大規模なモンテカルロなら、事前計算の JSON。

| 計算 | 実測（秒） | 扱い |
|---|---|---|
| ルックバック、連続監視（1 点、100 点） | 0.000 | ライブ |
| ルックバック、離散監視 400 段（グリークスつき） | 0.08 | ライブ |
| ルックバック、離散監視 1600 段 | 1.2 | 事前計算（収束） |
| CB 300 段（グリークスつき） | 0.08 | ライブ |
| CB 1000 段 | 0.78 | 事前計算 |
| MSCB（転換時）300 段 | 0.08 | ライブ |
| MSCB（持ち越し）縮約 400 段（グリークスつき） | 0.14 | ライブ |
| MSCB（持ち越し）格子 40 点・200 段（値だけ） | 0.03 | ライブ |
| MSCB（持ち越し）格子 80 点・400 段（値だけ） | 0.25 | ライブ（上限に近い） |
| MSCB（持ち越し）格子 40 点・200 段（グリークスつき） | 1.3 | 事前計算 |
| MBS の OAS 200 経路 | 0.17 | ライブ |
| PRDC のモンテカルロ 20 万経路 | 0.10〜0.12 | ライブ |
| PRDC の 3 因子（TARN・ノックアウトつき）5 年・12 ステップ/年、5,000 経路 | 0.22（2026-11-22 に測定。2 万経路は 0.81） | ライブ（経路数 × ステップ数/年 × 年数 ≤ 300,000）。2 万経路・20 万経路は事前計算 |
| ヨーロピアンの学習（11.5）のフォワード | 見込み 0.01 以下（未確認） | ライブ |

- 値は、`rmql` の `tools/bench/bench_r.R` と、同じ日の P16 の測定による。ベンチの値は、PC の状態で 3〜4 倍変わる（同じ日でも）ので、実装のときに、API ごとに測り直す。
**ライブ API の上限（確定）**：次の上限を超える入力は、HTTP 400 と日本語のメッセージ（既存の API と同じ形、例：「段数は 2〜400 にしてください」）で拒否する。上限は、この PC の実測（上の表）で 0.3 秒以下に収まる値。

| API | 入力 | 上限 | 根拠（実測） |
|---|---|---|---|
| `POST /api/lookback` | `steps` | 2〜400 | 離散 400 段で 0.08 秒（1600 段は 1.2 秒） |
| | `monitoringCount` | `steps` 以下 | 監視日は段に置く |
| `POST /api/convertible` | `steps` | 2〜300 | 300 段で 0.08 秒（1000 段は 0.78 秒） |
| | コール・プットの行数 | 10 以下 | 300 段・10 行で 0.08 秒（2026-11-22 に測定） |
| `POST /api/mscb`（`scaled`） | `steps` | 2〜400 | 400 段・グリークスつきで 0.14 秒 |
| | `resetDates` の数 | 12 以下 | 400 段で 4・8・10 回が 0.12〜0.14 秒（2026-11-22 に測定。縮約の計算量はリセットの数にほとんど依らない）。実装では 12 回・400 段が API テストで通る |
| `POST /api/mscb`（`grid`） | `greeks` | **常に `false`**（`true` は 400） | グリークスつきの格子は 1.3 秒（事前計算） |
| | `priceNodes` | 2〜80 | 80 点・400 段で 0.25 秒（値だけ） |
| | `steps` | 2〜400 | 同上 |
| | `priceNodes` × `steps` | 32,000 以下 | 同上（0.25 秒の条件） |
| `POST /api/mbs/state`（OAS を含む） | `paths` | 2〜200（偶数。対称変量の対） | 200 経路の OAS で 0.17 秒 |
| | `months` | 360 以下 | 同上 |
| `POST /api/prdc`（モンテカルロ） | `paths` | 20 万以下 | 20 万経路で 0.10〜0.12 秒 |
| `POST /api/prdc/tarn`（3 因子） | `paths` | 200〜2 万（かつ下の積の上限） | 5,000 経路・12 ステップ/年・5 年で 0.22 秒、7,000 経路で 0.29 秒、1 万経路で 0.40 秒（2026-11-22 に測定。旧表の 0.05 秒は誤り） |
| | `stepsPerYear` | 1〜12 | 同上 |
| | `paths` × `stepsPerYear` × `years` | 300,000 以下 | 上の 5,000 × 12 × 5 の条件。年数は 2〜10 |
| `POST /api/cnn/bs-surrogate` | 入力 | 学習範囲の外は警告つきで受ける | 見込み 0.01 秒以下（未測定） |

- 実測のなかった上限（`resetDates` が 5 回以上、コール・プットが 10 行）は、2026-11-22 に測り、0.3 秒を超えなかったので、上限は変えていない。上限の値は、API ごとに、定数として 1 か所に置き、テスト（上限ちょうどは通り、上限を超えると 400）で確かめる。
- 上限を超える計算（収束の研究、グリークスつきの格子、大規模なモンテカルロ）は、事前計算の JSON で見せる（4.3 の `server/data/p16/` など）。

## 8. 既存コードの変更範囲

**章番号と構成**（旧 13 章を 15 章へ、13・14 章を新設）：

| 場所 | 変更 |
|---|---|
| `ui/src/book/chapters.ts` | 先頭のコメント（1 to 13 → 1 to 15）、`CHAPTER_ICONS`（13・14 を足し、15 を `derivative` に）、`merge(13, …)`・`merge(14, …)` を足し、旧 `merge(13, "エキゾチック自動微分", …)` を `merge(15, …)` に。`ROUTE_ALIASES` は変えない |
| `ui/src/book/toc.ts` | 13・14 章の `Chapter`（`id` は `LC-1`、`MP-1` のような独自の ID、`source` は「Carmine-Studio の独自の章」）を足す。`II-9`（PRDC）の所属を、14 章に移す（確定）：`merge` の ID を 14 章の側に書き、`#/prdc` の URL は変えない |
| `ui/src/App.tsx` | 2 つの MDX の import と、`CHAPTERS` のルートを足す。先頭のコメント |
| `ui/src/components/icons.tsx` | 13・14 章のアイコン（2 つ）を足す |
| `ui/src/content/chapters/cnn-applications.mdx` | 「第 13 章（自動微分）」を「第 15 章」へ（12.5 の題と、表の中のリンクの文字） |
| `ui/src/content/chapters/cnn-fundamentals.mdx` | 同じく 2 か所（冒頭の説明と、11.3 の末尾）。11.5 の差し替え |
| `ui/src/content/prdc.mdx` | 自動微分へのリンクの文字（URL は同じ） |
| `ui/src/book/TocPage.tsx` | 説明文の章の数（「全 13 章」）があれば直す |
| `README.md` | 表（3・22・23・41・56・57・60 行付近）の章番号、13・14 章の行、「13.1 PRDC」の番号 |

**新設**（章ごと）：

| 種類 | 場所 |
|---|---|
| R API | `server/R/lookback_model.R`、`convertible_model.R`、`mbs_model.R`、`bs_surrogate_model.R`。`server/server.R` に `source` とルートと先頭のコメント |
| 事前計算のスクリプトと JSON | `server/scripts/p16/*.R`、`server/scripts/cnn/train_bs_surrogate.R`、`server/data/p16/`、`server/data/cnn/bs_surrogate_results.json` |
| 画面 | `ui/src/api/*.ts`（クライアント）、`ui/src/components/lookback/`、`convertible/`、`mscb/`、`mbs/`、`bsSurrogate/`、MDX 2 つ |
| テスト | `ui/tests/*.api.test.ts`（各 API）、`server/tests/reconciliation/p16/`（4.4 の照合） |

## 9. 実装の順序と、確定した判断（2026-11-22）

**順序**：(1) **済み**：rmql を 0.5.0 に上げて、この PC の既定のライブラリーに入れた。`server/server.R` に、`packageVersion("rmql") >= "0.5.0"` のチェックを足した → (2) 章番号・ルーティング・アイコン・空の MDX（既存のテストが通ることを確認）→ (3) 13 章：ルックバック → CB → MSCB（転換時）→ MSCB（持ち越し）の順に、API・照合・画面・本文 → (4) 14 章（`#/prdc` を 14.1 に移す）→ (5) 15 章の導入と、11.5 の差し替え → (6) README、`npm run build`、`npm test`。段階ごとに報告し、コミットと push は、指示があったときに行う。

**確定した判断**：

1. **rmql の版**：`0.5.0` に上げ、この PC の既定のライブラリーに 1 回入れる。`server/server.R` に版のチェックを入れる。GitHub の Release と gh-pages への公開は、後で判断する。
2. **11.5 のモデル**：全結合（MLP）で、スカラー入力のブラック・ショールズ関数を学習する。
3. **15 章**：13 章のグリークスと自動微分の関係（一部が自動微分）を述べるだけにし、新しい検証の画面は足さない。自動微分の紹介は 13 章にも入れる（2026-11-22、ユーザーの指示）。
4. **`#/prdc` の居場所**：14 章の下（14.1 PRDC）へ移す。URL は維持する。
5. **MSCB の 2 次元格子のグリークス**：事前計算。ライブは、`scaled`、または `grid` で `greeks = FALSE`。
6. **ライブ API の上限**：7 章の 0.3 秒の基準で確定。各 API の上限は、7 章の表。超過は HTTP 400。

## 10. Coral-Book との関係（参考）

理論の部分（状態の表、相似縮約の導出、閉じた式）は、固まった段階で、Coral-Book の独立した節か補論に抜き出す予定だが、**別途の指示があるまで行わない**。実装、数値、画面は、Carmine-Studio と rmql に残す。この設計書の記号と式は、rmql の `docs/spec_lookback_convertible.md` に合わせてある。

Coral-Book のフォルダーと GitHub のリポジトリ名は、2026-11-22 に `Coral-Book`（`besuke/Coral-Book`）に改めた（`Carmine-Studio` も同日に改めた）。

**実装の記録（2026-11-22、第 13 章のバックエンド）**：上限は `server/R/lookback_model.R` の `P16_LIMITS` に 1 か所で置き、`ui/tests/p16.api.test.ts` が「上限ちょうどは通り、超えると 400」を確かめる。ルックバックの離散監視は、監視日が段に置かれるので、段数が監視回数の倍数でないと値が段の位置で振れる（月次 12 回で 400 段は 12 の倍数でない）。そのため API の既定の段数は 360 とし、照合は 132 と 396 段で外挿する。事前計算の JSON は 4 つで、各ファイルの `meta` に rmql の版・実行日・乱数の種を持つ。

**実装の記録（2026-11-22、第 14 章のバックエンド）**：`server/R/mbs_prdc_model.R`（`P14_LIMITS` に上限を 1 か所で置く）、`POST /api/mbs/state`、`POST /api/prdc/tarn`、`GET /api/mbs-prdc/summary`。事前計算は `server/scripts/p14/` から `server/data/p14/` の JSON 2 つ（OAS の収束、TARN の分布）で、rmql の版・実行日・乱数の種を持つ。照合は `server/tests/reconciliation/mbs_prdc/`（`npm run reconcile:mbs-prdc`、14 項目）。**TARN の条項（目標に達した日のクーポンの扱い、ノックアウトの観測日）は、独立なシミュレーションとの照合をしていない**（恒等式と確率の整合だけ。記録に書いてある）。経路数が偶数でないと 400 になる（rmql の対称変量の制約）。
