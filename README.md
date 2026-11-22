# Carmine-Studio『エンタープライズ金融モデル』

金融モデルを「手元で計算する」「サーバーで動かす」「仮定から何が導けるかを証明する」の三つの入口から学ぶ三部作のうち、**React で条件を操作し、R サーバー上の rmql でモデルを評価する** Web アプリです。Coral-Book『金融工学の応用基礎』の無裁定モデルの数式と解説を読みながら、ブラウザで金融モデルを動かせます。「 9. 並列計算」「10. 分散計算」「15. 自動微分」では、同じモデルを多数のシナリオや感応度へ広げる計算を扱い、「11. CNN の基礎と実践」「12. CNN の金融モデル応用」では、畳み込みニューラルネットワークの式と、国債カーブの翌月予測の実験、重いモデルの近似への応用を扱います（この 2 章は Carmine-Studio の独自の章で、Coral-Book に対応する章はありません）。メニューと目次は部に分けず、一つの章の並びにしています（各章には Coral-Book の章番号を添えています）。計算は R の HTTP API（開発時は 127.0.0.1:8787）が rmql で行い、React は返ってきた JSON を本文・表・グラフに表示します。画面は <http://127.0.0.1:8081/> です。

## 三部作

| | Coral-Book『金融工学の応用基礎』 | Carmine-Studio『エンタープライズ金融モデル』 | Crimson Proof『Leanから見た金融数学』 |
|---|---|---|---|
| 学び方 | **手元で計算する**：理論を読み、手元の R で計算を再現する Quarto の本 | **サーバーで動かす**：React で条件を操作し、R サーバー上の rmql でモデルを評価する Web アプリ | **証明する**：金融モデルの仮定を Lean で定義し、どの仮定のもとで何が成り立つかを証明する本 |
| リポジトリ | <https://github.com/besuke/Coral-Book> | <https://github.com/besuke/Carmine-Studio> | <https://github.com/besuke/Crimson> |
| 始め方 | `quarto render`（または RStudio で各章を実行） | R API（`npm run api`、127.0.0.1:8787）と画面（`npm run dev`）を起動し、<http://127.0.0.1:8081/> を開く | `lean/` で `lake build`、本は `quarto render` |

## 同じテーマを三つの入口で

| テーマ | Coral-Book（手元で計算する） | Carmine-Studio（サーバーで動かす） | Crimson Proof（証明する） |
|---|---|---|---|
| 割引と無裁定 | 第II部 第1章 確定キャッシュフロー、第3章 OISスワップとマルチカーブ評価で、割引係数と複製を手で計算する | 「イールドカーブと円OIS」（`#/yield-curve-ois`）で OIS の気配を動かしてスワップの時価を確かめる。「OISアセットスワップ」（`#/asw`） | 第10章 有限市場における無裁定と価格の一意性、第11章 ニューメレール、第12章 資産価格の基本定理で、無裁定に必要な市場の仮定を定義して定理を証明する |
| 金利カーブ | 第II部 第2章 金利カーブ | 「金利カーブ」（`#/yield-curves`）、「国債先物・CTD」（`#/jgb-futures`） | 第11章 ニューメレール（割引による価格の正規化） |
| オプション | 第II部 第4章 ブラックモデル | 「ブラックモデル」（`#/black-model`） | — |
| 信用リスク | 第II部 第5章 信用リスクとCDS | 「信用リスクとCDS」（`#/credit-cds`） | — |
| 金利モデルと早期償還 | 第II部 第6〜8章 | `#/irs-calibration`、`#/rate-models`、`#/early-redemption` | — |
| PRDC | 第II部 第9章 | 「PRDC」（`#/prdc`）、「14. MBS・PRDC」の 14.1 PRDC | PRDC のクーポンの分解（`lean/LagrangeAcademy/PrdcCoupon.lean`） |
| 並列・分散・自動微分 | — | 「 9. 並列計算」（`#/enterprise/parallel-computing`）、「10. 分散計算」（`#/enterprise/distributed-jobs`）、「11. CNN の基礎と実践」（`#/enterprise/cnn-fundamentals`）、「12. CNN の金融モデル応用」（`#/enterprise/cnn-applications`）、「13. ルックバック・転換社債・MSCB」（`#/enterprise/lookback-convertible`）、「14. MBS・PRDC」（`#/enterprise/mbs-prdc`）、「15. 自動微分」（`#/enterprise/automatic-differentiation`） | — |
| 計算の保証 | 各章の計算例 | 照合の記録（`server/tests/reconciliation/`） | 第1章 計算と証明、第7章 実数と数値計算 |

画面のパスは <http://127.0.0.1:8081/> に続けて開きます（例：<http://127.0.0.1:8081/#/yield-curve-ois>）。目次ページにも同じ表があり、Coral-Book と Crimson Proof の章へリンクしています。

## 設計の要点

詳しい説明は本文の「序論」（<http://127.0.0.1:8081/#/introduction>）にあります。

- **役割分担**：React（TypeScript）は入力と結果の表示を担当し、金融の計算はしません。R の HTTP API（`server/`）は入力を検査し、`rmql` の計算結果を JSON で返します。計算ロジックは Rust の `rmql`（rmql リポジトリ）に置きます。
- **Rust を使う理由**：所有権と借用の規則をコンパイラが検査するので、市場データを共有しながら銘柄ごとの評価や自動微分を並列に動かしても、データ競合が起きません。Cargo でビルド・テスト（参照値との照合を含む）・ドキュメント生成を共通の手順で扱えます。
- **並列と分散**：一台では `furrr::future_map()` で R のワーカーに仕事を配り、各ワーカーが `rmql` を呼びます。Rust 側の一括評価もスレッドで並列化でき、結果はスレッド数によりません。第10章の実演では、ブラウザがシナリオを複数のリクエストに分けて単一の R API へ送り、応答を集約します。複数ノードへは `future.batchtools` の Slurm 連携で広げる構想です（未導入）。
- **画面**：計算は非同期で、最後の入力に対する応答だけを表示に使います。一部の表とグラフは、操作性の参考例としてインタラクティブにしています（例：イールドカーブの年月スライダーと再生）。サーバー側のバックグラウンドジョブ、Excel 風の表入力と出力は構想です。

## 画面

| 画面 | 内容 | URL（開発時） |
|---|---|---|
| 目次と対応状況 | 序論と全15章について、操作できること、rmql で計算できる範囲、追加実装が必要な箇所（`ui/src/book/toc.ts`） | http://127.0.0.1:8081/#/ |
| 序論 | Coral-Book で手元の R を使って再現した金融モデルを、複数の利用者がブラウザから使える形にする設計の考え方（役割分担、Rust、並列・分散計算、非同期の画面） | `#/introduction` |
|  1. 確定キャッシュフロー | TONAR のパー・スポット・フォワード、順・逆イールドの模式図、40年債のキャッシュフロー、単利→単価→複利利回り、フラットイールド、Zスプレッド、BPV・デュレーション・コンベクシティ、利回りの数値解法（II-1.1〜1.8。GaussQuant・原稿の結果に照合）。取引日・発行日・償還日を変えられる（`bond.tradeDate`・`issueDate`・`maturityDate`、既定は原稿の例。Infrago Quantlet から移した） | `#/deterministic-cashflow` |
|  2. 金利カーブ | ゼロ金利ノードと平行シフトを操作して、ZeroCurve・DiscountCurve・シフト後のカーブを描く（II-2.2、2.3.1、2.5.2〜2.5.3。GaussQuant と差 0）。財務省の国債金利（月末、1990年1月〜）から作ったカーブを、年月スライダーと再生で切り替える。ノードのシミュレーション（1つのノードのゼロ金利だけを bp 動かし、割引係数とゼロクーポン債の価格の変化を見る。`POST /api/curves/zero` の任意の入力 `bump`。Infrago Quantlet から移した） | `#/yield-curves` |
| 2.1 国債先物・CTD | 受渡適格銘柄の Basis・Implied Repo・CTD と先物BPV（CTD の DV01 ÷ CF）。全銘柄の利回り水準と Funding Rate を動かして CTD の入れ替わりを見る（II-2.6〜2.7。現物価格は架空。GaussQuant・原稿のストレス結果と差 0） | `#/jgb-futures` |
|  3. OISスワップ | 数式の説明から、5年クォート＋1 bp で7年OISの時価が動くところまで | `#/yield-curve-ois` |
|  4. ブラックモデル | Black 76 の価格と Greeks（公式と Black process）、モンテカルロの収束・パス・満期分布、European／American put の解析解・CRR・近似式、Sobol パスと Longstaff–Schwartz。入力・乱数・パス数を動かす（II-4.1〜4.6。GaussQuant・原稿の結果に照合。疑似乱数の MC は乱数が別） | `#/black-model` |
|  5. 信用リスクとCDS | 1年物（MidPoint）と標準5年物（CDS2015、ISDA）の各レグ・NPV・Fair Spread・Fair Upfront・Accrual Rebate、ゼロ NPV の Hazard Rate、支払日ごとの表と手計算。市場 Spread・契約 Coupon・Recovery・割引率を動かす（II-5.1〜5.6。GaussQuant・原稿の結果と差 0） | `#/credit-cds` |
|  6. キャリブレーション | Normal・Black ボラの比較、SABR のスマイル（原稿の optim と calibrate_sabr）、Hull–White の債券オプションへの適合と未使用商品の検証、BGM の相関の減衰（II-6.1〜6.6。GaussQuant・原稿の結果に照合） | `#/irs-calibration` |
|  7. 金利モデル | Hull–White の短期金利の経路と割引の検証、HJM のフォワードの変動係数、キャップレットの公式とモンテカルロ・満期のフォワードの分布、相関ショック、後決め金利の複利（II-7.1〜7.6。原稿のコードと原稿の結果に照合） | `#/rate-models` |
|  8. 早期償還モデル | Hull–White のコール債（Bullet・Callable・コール権の価値、コール日ごとの判断、ボラティリティと格子の検証）、MBS のプリペイメント（シナリオ別の CPR と加重平均残存年数、金利経路、PSA 別の静的 OAS）（II-8.1〜8.8。原稿の結果に照合）。コール判断（各コール日の、継続価値とコール価格の比べと境界）は rmql の `compute_hull_white_callable_bond_decisions`（0.4.0 から。以前は原稿の独自の R 関数で求めていたが、同じ結果を rmql が返す）で計算する | `#/early-redemption` |
|  9. 並列計算 | Coral-Book III-1 の本文に、6シナリオの逐次・並列の例、債券の件数とスレッド数を選んだ一括評価の測定、PRDC のモンテカルロのスレッド比較を組み込んだ章（結果はスレッド数によらず同じ） | `#/enterprise/parallel-computing` |
| 10. 分散計算 | Coral-Book III-2・III-3 の本文に、45シナリオをジョブに分けてブラウザから R API へ送り、集約する画面を組み込んだ章 | `#/enterprise/distributed-jobs` |
| 11. CNN の基礎と実践 | 畳み込みの定式化（フォワード）と勾配の導出（バックワード）、財務省の月末の国債利回り（442 か月）から翌月の変化を予測する 1D-CNN の実験（ランダムウォーク・リッジ回帰と、ウォークフォワードで比較。数値勾配チェック付き）、予測・実績のカーブでの債券の価値と損益（rmql）、ヨーロピアン・オプションの曲面への応用（解説）。学習はオフラインのスクリプト（`server/scripts/cnn/train_jgb_1d_cnn.R`）で、結果は `server/data/cnn/jgb_1d_cnn_results.json`。Coral-Book に対応する章はない | `#/enterprise/cnn-fundamentals` |
| 12. CNN の金融モデル応用 | Hull–White、MBS、CLO・CDO のトランシェを CNN で近似する場合の設計と、自動微分との比較（解説のみ） | `#/enterprise/cnn-applications` |
| 13. ルックバック・転換社債・MSCB | 「明日からの価値のために、今日までの何を覚えておくか」を貫く問いにして、ルックバック（最小値）、転換社債、MSCB（転換価額）の状態と次元の縮約を扱う、Carmine-Studio の独自の章（実装済み：ライブの計算と事前計算の表。設計：`docs/part3_chapters_13_15_spec.md`）。Coral-Book に対応する章はない | `#/enterprise/lookback-convertible` |
| 14. MBS・PRDC | 縮約できない経路依存（MBS の元本残高、TARN の累積クーポン）を経路ごとに持ち越す、Carmine-Studio の独自の章（準備中）。PRDC の画面は 14.1 | `#/enterprise/mbs-prdc` |
| 15. 自動微分 | Coral-Book III-4〜III-7 の本文（III-1.7 を導入に）に、PRDC の12の感応度を自動微分で一度に求めて Bump & Revalue（24回の評価）と比べる画面と、パスごとの自動微分のモンテカルロを組み込んだ章。旧ページ（`#/parallel`、`#/prdc-risk`、`#/enterprise/...`）からは、統合先の節へ移る。統合は `docs/port/merge_part3.py` | `#/enterprise/automatic-differentiation` |
| 14.1 PRDC | クーポンのペイオフ、FX のサンプルパス、現在価値（閉じた式とモンテカルロ）、期待クーポンの期間構造とフロア・キャップの確率、クーポンの分布、FX スポット・ボラ感応度（II-9.1〜9.6。原稿の結果に照合） | `#/prdc` |
| サーバー接続 | rmql Compute Server（R の HTTP API）との接続の状態、往復の時間、利用者が開くアドレス、API の一覧。右上の「rmql Compute Server：接続中／未接続」からも開く | `#/server` |

メニューと目次の番号は、主章が 1.〜15.、章の下のページが「2.1」「14.1」です（序論とサーバー接続は番号なし）。本文の見出しも同じ番号です。上の帯は、左に二段の文字「Carmine-Studio」「エンタープライズ金融モデル」です。オファーシート（POC と ASW）は Infrago Quant に移したので、メニューと目次から外しました（`ui/src/asw/` のコードと API は残してあります）。

## 構成

| 役割 | 担当 | 場所 |
|---|---|---|
| 計算（カーブ構築、割引係数、フォワード、7年OISのパーレートとPV） | R の **rmql**（ローカルHTTP API） | `server/` |
| 画面（MDXの本文と数式、表、グラフ、操作） | React＋TypeScript（Vite） | `ui/src/` |
| APIの回帰テスト | Vitest。照合済みJSONと比べる | `ui/tests/` |
| 照合済みJSONの生成 | R の rmql | `server/tests/golden/` |
| GaussQuant（QuantLib）との照合記録 | R | `server/tests/reconciliation/` |

TypeScript は金融計算をしません。APIへの送信と、返ってきた値の表示だけを担当します。表示のために、2本のカーブの差（変更後 − 初期）を引き算することはあります。

```
ブラウザ (React)  --POST /api/scenario {"bumpTenor":"5Y","bumpBp":1}-->  Vite (8081, /api を転送)  -->  R API (127.0.0.1:8787)
                  <--------- 初期・変更後の割引係数、フォワード、7年パーレート、PV、PV差（JSON） ---------
```

13本のクォート、評価日、計算規約、7年OISの契約条件は、すべてR側（`server/R/tona_ois_model.R`）で管理します。ASW のオファー・銘柄属性・OIS 気配は `server/data/asw_demo/`、計算は `server/R/asw_model.R` です。

## 起動（Windows）

前提：R に **rmql 0.5.0 以上**（`server/server.R` が起動時に確かめます）、GaussQuant（サンプルのクォートだけに使う）、httpuv、jsonlite が入っていること。確認は R 4.6.0（`C:/Program Files/R/R-4.6.0`）、Node.js 26（npm 11）です。rmql（<https://github.com/besuke/RiemannQL>）は、Windows ではバイナリで入ります（R 4.4・4.5・4.6 用。Rust も Rtools も不要）。

```r
install.packages("rmql", repos = c("https://besuke.github.io/RiemannQL", "https://cloud.r-project.org"))
```

起動はプロジェクトの `CarmineStudio.ps1`（デスクトップのショートカット「Carmine-Studio」）でできます。メニューの「1」でこのPCの開発用（rmql Compute Server 127.0.0.1:8787 と画面 http://127.0.0.1:8081/）、「2」で社内LANへの公開です（次の「社内LANで使う」）。引数でも選べます：

```powershell
powershell -ExecutionPolicy Bypass -File C:\AnalyticFin\Projects\Carmine-Studio\CarmineStudio.ps1 dev
powershell -ExecutionPolicy Bypass -File C:\AnalyticFin\Projects\Carmine-Studio\CarmineStudio.ps1 lan
```

npm で直接起動する場合：

```powershell
cd C:\AnalyticFin\Projects\Carmine-Studio\ui   # npm は ui/ で実行する
npm install          # 初回のみ

# ターミナル1：R API（127.0.0.1:8787）
npm run api

# ターミナル2：画面（http://127.0.0.1:8081/）
npm run dev
```

ビルドした版を見る場合は、`npm run build` の後に `npm run preview`（同じく http://127.0.0.1:8081/、`/api` はR APIへ転送。`npm run dev` とは同時に使えない）を使います。R API が動いていないと、画面に起動コマンドと再試行ボタンが表示されます。

### ポート

| 用途 | ポート |
|---|---|
| 画面（`npm run dev`・`npm run preview`）、社内LAN（`npm run lan`、画面とAPIを1つのポートで） | **8081** |
| 開発用の R API（`npm run api`。画面の `/api` の転送先） | 8787 |
| テスト（`npm test`）が起動する R API | 8788 |

8081 は1つのプロセスしか使えないので、`npm run dev`・`npm run preview`・`npm run lan` は同時に起動しません。

**8081 が使用中のとき**：3つのコマンドはどれも、起動前に `ui/scripts/check-port.mjs` でポートを確かめ、使用中なら別のポートに切り替えずに、次のように理由を表示して止まります（終了コード 1）。Vite も `strictPort: true` なので、自分で別のポートに移ることはありません。

```
ポート 8081（127.0.0.1）は使用中のため起動しません（EADDRINUSE）。別のポートには切り替えません。
使っているプロセスを止めてから、もう一度実行してください。確認：netstat -ano | findstr :8081
```

`netstat -ano | findstr :8081` の最後の列がプロセス番号です。`tasklist /FI "PID eq <番号>"` で何かを確かめ、不要なら止めてから実行し直してください。

## 社内LANで使う

このPCをサーバーにして、同じ社内LANの他のPCやスマートフォンのブラウザから使います。ログインはありません。LANに届く人なら誰でも使えます。

```powershell
powershell -ExecutionPolicy Bypass -File C:\AnalyticFin\Projects\Carmine-Studio\CarmineStudio.ps1 lan
```

（メニューの「2」と同じです。`npm run lan` を直接実行してもかまいません。）画面をビルドしてから rmql Compute Server を起動し、全てのネットワークインターフェース（`0.0.0.0`）の 8081 番で画面（`dist/`）と API を同じポートで返します。止めるときは「Carmine-Studio - LAN (8081)」のウィンドウを閉じます（`npm run lan` なら Ctrl+C）。

### 利用者に案内するアドレス（配備先のホスト名）

起動スクリプトが開く URL、起動時に表示する URL、接続ページの「利用者が開くアドレス」には、**サーバーの DNS 名か LAN の IP アドレス**を使います。`127.0.0.1` はこのPCでの開発と内部の確認だけに使います。

| 優先 | 指定のしかた | 例 |
|---|---|---|
| 1 | 環境変数 `CARMINE_PUBLIC_HOST` | `$env:CARMINE_PUBLIC_HOST = "carmine.example.local"` |
| 2 | プロジェクト直下の `carmine.config.json` の `publicHost`（`carmine.config.example.json` を写して作る。Git には入れない） | `{ "publicHost": "carmine.example.local", "port": 8081 }` |
| 3 | どちらもないとき：このサーバーの LAN の IPv4 アドレス（127.* と 169.254.* を除く） | `http://192.168.1.254:8081/` |

ホスト名を指定したときも、LAN の IP アドレスを続けて表示します。起動スクリプトは、指定した名前でこのPCから開けないとき（DNS 未登録、ファイアウォールなど）に注意を表示します。

`npm run api` と `npm run dev` は、これまでどおり `127.0.0.1` だけで待ち受けます。LANに出るのは `npm run lan` のときだけです。

### Windows ファイアウォール（初回のみ、管理者のPowerShell）

社内LANでは、Windows はふつう「ドメイン」ネットワークとして扱います。その場合、8081番への受信を許可する規則が必要です。

```powershell
New-NetFirewallRule -DisplayName "Carmine-Studio (TCP 8081)" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Domain,Private
```

- 規則を作らないと、他のPCからは接続できません（このPCからは開けます）。
- 社内のセキュリティポリシーで規則が無効になる場合や、作れない場合は、情報システム部門に相談してください。
- 公衆Wi-Fiなど「パブリック」のネットワークでは `npm run lan` を使わないでください。このPCには以前から R に対する「パブリック」の受信許可（`R for Windows front-end`）があり、`npm run lan` 中はそのネットワークからも接続できてしまいます。不要なら「Windows Defender ファイアウォール」の受信の規則から無効にできます。
- 規則を消すとき：`Remove-NetFirewallRule -DisplayName "Carmine-Studio (TCP 8081)"`

### 確認したこと（2026-11-16）

`CarmineStudio.ps1 lan` で起動し、このPCから LAN の IP アドレス（`http://192.168.1.254:8081/`）とホスト名（`http://CHIRO_FMV_PC:8081/`、`carmine.config.json` の `publicHost` に指定）の両方で、画面・`/api/health`・計算（`POST /api/bond`）・接続ページの「利用者が開くアドレス」を確認しました。**別の端末のブラウザからの確認は、まだしていません。**

### 確認したこと（2026-11-14）

このPCの LAN のアドレス（当時のポート 8787：`http://192.168.1.254:8787/`。2026-11-14 に 8080、その後 8081 に変更）経由で、画面、API（5年＋1 bp で PV差 1,512,212.8199円）、ブラウザでの操作を確認しました。存在しないパスと、`dist` の外のファイルを指すパス（`/../server/server.R` など）は 404 になります。**別のPCからの接続は、まだ確認していません。** 確認したときのネットワークは「パブリック」の Wi-Fi で、社内LANではなかったためです。

### 制約

- R のサーバーは1本の処理で順に計算します。1回の計算は約0.2秒なので、数人で同時に使う程度を想定しています。
- 通信は暗号化されていない HTTP です。社内LANの中だけで使ってください。
- このPCがスリープしたり、`npm run lan` を止めたりすると使えなくなります。

## 計算条件

照合（`server/tests/reconciliation/RECONCILIATION.md`）の気配セット `without_7y`、補間 `log_linear` と同じ条件です。画面の「1. 計算条件」にも表示しています。

| 項目 | 値 |
|---|---|
| クォート | 円TONA OIS 13本（1M, 3M, 6M, 1Y, 2Y, 3Y, 4Y, 5Y, 8Y, 10Y, 15Y, 20Y, 30Y）。GaussQuant `bluegamma_tonar_quotes_GQL()` の14本から7年を除いたもの。**サンプルデータ** |
| クォートの単位 | 小数の金利（0.0224 = 2.24%）。画面では % で表示 |
| 評価日・カーブの基準日 | 2026-09-10 |
| カレンダー | 日本（rmql の QuantLib 互換カレンダー） |
| カーブの日数計算 | Actual/365 Fixed |
| OISの受渡日数 | 2営業日（スポット日 2026-09-14） |
| 支払頻度・支払ラグ | 年1回・0営業日（QuantLib の既定。市場慣行とされる2営業日とは異なる） |
| 日程 | Backward、Modified Following（月末の扱いなし） |
| 固定レグの日数計算 | Actual/365 Fixed |
| ピラー | 最終関連日 |
| 補間 | 割引係数の対数線形 |
| ブートストラップの精度 | 割引係数で 1e-12 |
| フォワード | 1暦日の単利、Actual/365 Fixed：F(d) = (P(d)/P(d+1) − 1) ÷ (1/365)。ピラー間の連続複利フォワードも表で表示 |
| 7年OIS | 固定払い・TONA受け、想定元本 100億円、2026-09-14 開始、2033-09-14 満期 |
| 固定レート | 初期カーブの7年パーレート（丸め前）0.024916575169051068。変更後も据え置き |
| 操作 | 5年クォートだけを ＋1 bp、または初期値に戻す |

## API

`GET /api/cnn/jgb-summary` と `POST /api/cnn/jgb-forecast`（第 11 章）

```json
{ "month": "202101", "bond": { "remainingYears": 10, "couponPct": 1, "faceAmount": 100 } }
```

- `jgb-summary` は、オフラインで学習した 1D-CNN の実験の結果（設定、数値勾配チェック、期間別・年限別の RMSE と MAE、過去 24 か月の RMSE の推移、カーネル）を返します。
- `jgb-forecast` は、`month`（予測の起点、`YYYYMM`。2001 年 1 月〜2026 年 9 月）の翌月について、実績・1D-CNN・リッジ回帰・ランダムウォークの 4 つのカーブで、債券（残存 2〜20 年の整数、クーポン 0〜10%、額面）を rmql で評価し、価値と損益を返します。範囲外の値は HTTP 400 です。応答に `response.request_id` を含みます。

`POST /api/scenario`

```json
{ "bumpTenor": "5Y", "bumpBp": 1 }
```

- `bumpTenor`：13本の年限のどれか。`bumpBp`：有限の数で、絶対値は100以下。それ以外は HTTP 400 を返します。
- 応答（`ui/src/api/types.ts`）：`conventions`、`quotes`（初期と変更後）、`swap_terms`（固定レート、日程）、`cases.base` と `cases.scenario`（`instruments`、`nodes`、`segments`、`curve_points` の日付・年数・割引係数・1日フォワード、`swap` のPV・両レグ・パーレート・キャッシュフロー）、`pv_change`、`par_change_bp`。数値は丸めていない倍精度です（17桁）。
- `curve_points` は、30年までの週次と月次の日付、主要年限の応当日、ピラーとその前後の日、7年OISの開始日と満期日を含みます。最後のピラーより先へは外挿しません。

`POST /api/curves/zero` と `POST /api/bond` は、任意の入力を持ちます（どれも省くと原稿の例）。曲線の `bump`（`{"tenor":"10Y","bp":100}`）は、1つのノードのゼロ金利だけを動かして曲線を作り直し、割引係数・ゼロクーポン債の価格・ゼロ金利の変化を `bump` に返します。債券の `bond.tradeDate`・`issueDate`・`maturityDate`（`YYYY-MM-DD`）は、取引日・発行日・償還日です（発行日の前後 1 年以内に取引日、発行日から 1〜60 年後に償還日）。範囲外や日付でない値は HTTP 400 です。どちらも Infrago Quant で先に作ったものを、2026-11-19 に移しました。

`GET /api/health` は状態と固定レートを返します。APIは `127.0.0.1` だけで待ち受けます。

すべての応答は `response.request_id` を持ちます。ページは要求ごとに `X-Request-Id` ヘッダーで ID を送り、サーバーはそれをそのまま返します（サーバーは状態を持ちません）。ページは、図・表・PV に同じ ID を表示し、送った ID と違う応答は受け付けません。

`GET /api/asw/report` は A1 POC の表のデータ（旧デモの値 `reference` 付き）、`POST /api/asw/offers/<id>/jgb-spread`（`{"spreadBp": 11.5}`）は円建て債券の JGB対比スプレッドを単価に換算する（参考機能）。`GET /api/asw/offers` はオファー一覧（計算できない行も理由付きで含む）、`GET /api/asw/offers/<id>`（例：`JPY-02`）は1件の詳細（カーブ、価格の換算、債券と翌日物レグのキャッシュフロー、ASW の内訳と確かめ）を返します。

## OISアセットスワップ・オファーシート

Coral-Book の `docs/asw_offer_sheet_spec.qmd` の発行通貨建て ASW を、Curie の A1 オファーシートのデモデータ（**架空**、評価日 2026-10-06、12件）で計算します。

- **ASW**：$s^* = (B - L - R - U,D(t,S)) / A$。債券CFを支払い、翌日物（日次複利）＋スプレッドと満期の元本を受け取り、受渡日に $U = N(P_d/100 - 1)$ を授受します。計算は rmql の `compute_ois_asset_swap`。詳細画面のキャッシュフローは `get_bond_cashflows` と `create_ois_swap`・`compute_ois_swap_cashflows` から組み立て、エンジンの値と一致することを確かめています。
- **規約**（Curie の旧デモと同じ）：OIS カーブは MonotonicLogCubic・年1回払い・支払ラグ0・外挿なし（JPY は TONA、USD は SOFR、EUR は €STR、受渡2営業日）。ASW の翌日物レグは年2回・支払ラグ0（Curie のデモの仮定）。銘柄属性は ISIN とオファー日で結合（exact）。
- **計算しない行**：変動利付債、期限前償還条項付き債、償還額が100でない債券、カーブの最後のピラーより後に満期がある債券、受渡日が合わないオファーなど。理由を表示し、行は残します。
- **データの更新**：`npm run snapshot:asw`（`server/scripts/asw/snapshot_curie_demo.R`）が Curie から `server/data/asw_demo/`（入力データ、オファーExcelの列の対応 `offer_columns.csv`、旧デモの結果 `curie_reference.json`）を作ります。出所は `server/data/asw_demo/PROVENANCE.md`。
- **照合**：`npm run reconcile:asw` と `server/tests/reconciliation/asw/RECONCILIATION_ASW.md`。テスト円債B（JPTEST000022）の ASW は旧デモ 10.484125871669359 bp との差 5.3e-15 bp（全10件で最大 2.8e-14 bp）。TEST USD BOND F（USTEST000016）の円換算 ASW は旧デモ 86.349380112377887 bp との差 7.3e-11 bp（全5件で最大 1.1e-9 bp）。
- **円換算 ASW**（外貨建て債券）：円担保・元本一定の通貨スワップ（外貨翌日物フラット支払、円TONAR＋ベーシス受取）で円にヘッジしたときの、円TONAR に対するフェア・スプレッド $s_j^* = (B_j - Q_j - U_j)/A_j$。満期のベーシス1点で外貨割引の一定スプレッド $z$ を $Q_f(z) - Q_j - bA_j = 0$ から校正する（CCS の期間構造の校正ではない）。計算は rmql の `compute_yen_asset_swap`。ベーシスは、元本一定・円担保の気配だけを同じ満期で平均し、評価日からの年数で自然3次スプライン補間（外挿なし、R の `stats::splinefun`）。FX スポットの受渡日が ASW の開始日と違う行は計算しない。データは `server/data/asw_demo/fx.txt`・`basis.txt`。
- **JGBスプレッド**（円建て債券）：（複利利回り − 同じ償還日に補間したJGB複利利回り）× 100 bp。複利利回りは日本式（利払・複利とも年2回、残存年数は満年数＋端数ACT/365、小数第7位で切り捨て）で rmql の `compute_compound_yield_from_price`。JGB 時価は `server/data/asw_demo/jgb.txt`。同じ受渡日の JGB を償還日ごとに平均し、受渡日からの年数で自然3次スプライン補間（外挿なし）。
- **入力項目と入力検証**：オファーExcelの見出しと共通形式の列の対応（`offer_columns.csv`、Curie の `convert_offer_sheet_Curie()` で作成）を詳細画面と POC に表示。入力検証は Curie と同じ問題コード（`unsupported_product` など）。
- **JGB対比スプレッドで提示された気配**：Curie は扱わない（単価 `offer_price` が必須）。POC の 3.3 で、Curie の定義を逆に解いて単価に換算できる（参考機能。特定のベンチマーク銘柄対比や単利利回りでの提示には対応しない）。
- **未対応**：元本リセット型 CCS、FX スワップによる受渡日の調整、CCS の期間構造の校正。

## 照合済みJSON（回帰テストの期待値）

`server/tests/golden/tona_ois_golden.json` は、`server/tests/golden/generate_golden.R` が rmql で作ります。このスクリプトは API のコード（`server/R/tona_ois_model.R`）とは別に書いてあり、同じ条件を独立に組み立てます。記録している内容は次のとおりです。

- クォート（初期・5年＋1 bp）、評価日、計算規約、5年＋1 bp の指定
- 7年OISの条件：想定元本、丸め前の固定レート、開始日・満期日、両レグの支払日程（計算期間、支払日、金額）
- 両ケースの各商品の日付と再現レート、カーブの節点、割引係数と1日フォワード（800点）、7年パーレート、PV、両レグのPV
- PV差（変更後 − 初期）

再生成の手順：

```powershell
npm run golden
# = Rscript server/tests/golden/generate_golden.R（ui/scripts/run-r.mjs が C:/Program Files/R/R-4.6.0/bin/Rscript.exe を呼ぶ。別の場所なら環境変数 RSCRIPT で指定）
```

スクリプトは17桁で書き出し、読み戻した値が元の倍精度と同じであることを確かめます。rmql を入れ替えたり、条件を変えたりした場合は、先に `npm run reconcile`（GaussQuant との照合、`server/tests/reconciliation/reconcile_tona_ois.R`）で照合し直し、その結果を確かめてから再生成してください。

## テスト

```powershell
cd ui
npm test      # Vitest。2026-11-22、17 ファイル・67 件がすべて合格（2026-11-20 は rmql 0.4.0 で 16 ファイル・63 件）
```

テストは R API を `127.0.0.1:8788` で起動し（`ui/tests/globalSetup.ts`）、`{"bumpTenor":"5Y","bumpBp":1}` と `{"bumpTenor":"5Y","bumpBp":0}` を送って、照合済みJSONと比べます。ASW は `ui/tests/asw.api.test.ts` と `ui/tests/asw.poc.test.ts` が全オファーを Curie の旧デモの結果（`server/data/asw_demo/curie_reference.json`）と比べます（ASW・円換算 ASW・JGBスプレッド・ベーシス 1e-6 bp、利回り 1e-10 %、価格 1e-10、CCS 校正の残差 1e-6 円。結果は `ui/test-results/asw-report.json`・`asw-poc-report.json`）。終わるとAPIを止めます。動いているAPIを使う場合は `LFL_TEST_API_URL=http://127.0.0.1:8787` を指定します。各項目の最大差は `ui/test-results/regression-report.json` に書き出します。

### 許容誤差と実測差（2026-11-14）

| 項目 | 件数 | 許容誤差 | 実測の最大差 |
|---|---|---|---|
| 商品の日付（開始日、満期日、ピラー）、キャッシュフローの日付 | 26＋28 | 完全一致 | 一致 |
| 再現レート | 26 | 絶対 1e-10 | 0 |
| 割引係数（節点） | 28 | 相対 1e-12 | 0 |
| 割引係数（800点） | 800 | 相対 1e-12 | 0 |
| 1日フォワード | 800 | 絶対 1e-10 | 0 |
| 固定レート | 1 | 絶対 1e-10 | 0 |
| 7年パーレート（両ケース） | 2 | 絶対 1e-10 | 0 |
| 7年OISのPV、両レグのPV（両ケース） | 6 | 絶対 0.1円 | 0 |
| キャッシュフローの金額 | 28 | 絶対 0.1円 | 0 |
| 初期PVがゼロであること | 1 | \|PV\| ≤ 0.1円 | 4.05e-6円 |
| PV差 | 1 | 絶対 0.2円 | 0（PV差 1,512,212.8199円、丸めると +1,512,213円） |
| 初期カーブでの7年パーと固定レートの差 | 1 | 絶対 1e-10 | 6.2e-17 |

許容誤差は GaussQuant と rmql の照合（`server/tests/reconciliation/RECONCILIATION.md` 4章）と同じです。根拠も同じで、割引係数はブートストラップの精度 1e-12、金利は 1e-6 bp、PVは想定元本あたり 1e-11（100億円で0.1円）です。今回は、APIと照合済みJSONが同じ rmql のビルドで計算されているため、差はすべて0でした。許容誤差は、rmql のビルドや実行環境が変わったときの最下位ビットの差を許すためのものです。

最後の行の 6.2e-17 は誤差ではありません。固定レートは「固定レート0のスワップのパーレート」として求め、テストでは「固定レートKのスワップのパーレート（K − NPV／年金現価）」と比べるため、最下位の桁が違います。

## ファイル

```
README.md、CLAUDE.md          この文書と、Claude Code 向けの決めごと
CarmineStudio.ps1            起動（dev / lan。npm は ui/ で動かす）
Carmine.Rproj、carmine.config.example.json   RStudio のプロジェクト、配備設定の見本
ui/                          画面一式。npm はここで実行する
  src/book/                  共通目次（toc.ts）、目次画面、ルーター
  src/api/                   APIの型とクライアント
  src/components/            グラフ（LineChart、FlowChart）と各章の部品（表示のみ）
  src/content/               章の本文と数式（MDX）
  src/asw/                   オファー一覧と詳細の画面
  tests/                     APIの回帰テスト（Vitest）
  scripts/                   check-port.mjs、run-r.mjs（R の起動）
server/                      R API と計算
  server.R                   R API（httpuv）
  R/tona_ois_model.R         円OIS：入力・規約と rmql の呼び出し
  R/asw_model.R              ASW：オファーと属性の結合、検証、rmql の呼び出し
  R/cnn_model.R              第 11 章：保存した 1D-CNN の結果の読み出しと、債券の評価（rmql）
  data/cnn/                  1D-CNN の実験の結果（jgb_1d_cnn_results.json。scripts/cnn/ が作る）
  data/asw_demo/             ASW のデモデータ（Curie から複製、架空）
  scripts/                   データ取得・複製のスクリプト（asw/・futures/・jgb/・capm/）と、1D-CNN の学習（cnn/）
  tests/golden/              照合済みの基準 JSON（generate_golden.R が作る）
  tests/reconciliation/      GaussQuant と rmql の照合（asw/ は Curie の旧デモとの照合）
docs/port/                   Coral-Book 第III部の移植ツールと記録
```

## 制約

- 照合と期待値は「QuantLib の既定の規約（支払ラグ0、年1回払い）」によるもので、市場で標準とされる規約ではありません。
- 7年OISの日付は、QuantLib の `MakeOIS` と同じ規則でR側で作ります。rmql には、期間からスワップの日付を作る `compute_ois_swap_dates` があります（0.4.0 に含まれる）が、この章はまだ使っていません（置き換えは未着手）。開始日が月末営業日の場合には対応していません。
- 照合の記録（`server/tests/reconciliation/`）は、主に rmql 0.3.0 の時点のものです。rmql 0.4.0 で、全テスト（Vitest 16 ファイル・63 件）と、照合スクリプト（`reconcile`、`reconcile:asw`・`cds`・`black`・`callable`・`calibration`・`rate-models`・`prdc`・`prdc-risk`・`parallel`、`golden`、npm のスクリプトがない `futures` と `curves` は `node scripts/run-r.mjs ../server/tests/reconciliation/<名前>/<スクリプト>.R`）が、最後まで通ることを確かめました（2026-11-20）。記録済みの結果ファイルは更新していません。
- `npm run reconcile:bond` は、rmql 0.3.2 以降で、日本式の複利利回りの小数の切り捨ての違いにより、7 項目が許容誤差を超えます（記録の最後の結果は rmql 0.3.0 のもの）。原因は、ライブラリー側の小数 4 桁の切り捨てだと考えていますが、未確認の推定です。
- 画面に出る名前は「Carmine-Studio」、リポジトリ名は `Carmine`。
- 計算にはR APIが必要です。ブラウザだけでは動きません。
