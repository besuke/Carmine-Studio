# Carmine Studio 第 11 章・第 12 章（CNN）新設 指示書（Claude Code 向け）

`C:\AnalyticFin\Projects\Carmine-Studio`（Carmine Studio）の第 III 部（エンタープライズ計算）に、**自動微分の前章として CNN（畳み込みニューラルネットワーク）の 2 章（第 11 章・第 12 章）を新設**し、旧 11 章（エキゾチック自動微分）を第 13 章へ繰り下げてください。

---

## 0. 基本方針・制約

- **`Coral Book` には手を加えない**：`Coral Book` は R＋QuantLib（C++ / GaussQuant）の照合基準として変更せず、第 III 部（並列・分散・CNN・自動微分）は Rust（`rmql`）を基盤とする `Carmine Studio` に一本化する（本文中で Coral Book の `I-7`・`I-11` や既存章との対比には触れる）。
- **役割分担（`Carmine/CLAUDE.md` 準拠）**：React/TS 画面は表示のみとし、金融計算は行わない。債券の時価・P&L 計算は必ず R API 経由で `rmql` を使う。`rmql` クレート自体は変更しない。
- **既存互換の維持**：既存 URL（`#/enterprise/automatic-differentiation` や `ROUTE_ALIASES`）は維持し、既存テスト（`npm test`）を壊さない。
- **用語統一**：**「フォワード」「バックワード」はそのまま使う**（「前向き」「前進」「後退」「後ろ向き」と訳さない）。
- **コミット・push**：完了報告のあと指示があるまで行わない。

---

## 1. 章立て（番号の振り直し）

- 9. 並列計算（既存：`#/enterprise/parallel-computing`）
- 10. 分散計算（既存：`#/enterprise/distributed-jobs`）
- **11. CNN の基礎と実践（JGB カーブ予測・ヨーロピアン）**（新設：`#/enterprise/cnn-fundamentals`、`ui/src/content/chapters/cnn-fundamentals.mdx`）
- **12. CNN の金融モデル応用（Hull–White・MBS・CLO）**（新設：`#/enterprise/cnn-applications`、`ui/src/content/chapters/cnn-applications.mdx`）
- **13. エキゾチック自動微分**（旧 11 を繰り下げ、URL `#/enterprise/automatic-differentiation` は維持。PRDC は 13.1 扱い）

---

## 2. 作業の順序（2 段階）

### Phase 1（先行）：JGB 1D-CNN 実験スクリプトの作成・実行・結果報告

まず `jgb_month_end.csv`（2Y・5Y・10Y・20Y が揃う月次 442 か月分）を使った学習・評価スクリプト（例：`server/scripts/cnn/train_jgb_1d_cnn.R`）を作成・実行し、**実測結果を報告してください（MDX 本文の実験考察はこの実測結果を見てから書く）**。

- **入力**：直近 12 か月の年限別利回り変化（$4\text{ チャネル} \times 12\text{ か月}$、時間方向に 1D 畳み込み）。
- **出力**：翌月の各年限（2Y・5Y・10Y・20Y）の利回り変化幅（bp）。
- **比較モデル（厳密なウォークフォワード：各予測時点より前のデータのみで学習・リークなし）**：
  1. ランダムウォーク（翌月も同じ水準：変化 0 bp）
  2. 同一入力（$4 \times 12$）の線形回帰（L2 正則化／Ridge を含む設定を明記）
  3. 小型 1D-CNN（11.2〜11.3 のフォワード／バックワード式を純 R で実装し、スクリプト内で**数値勾配チェック**を通す。外部 DL フレームワーク不要・シード固定で決定論的に再現可能）
- **保存物**：全ウォークフォワード予測・時系列誤差（RMSE / MAE）・代表時点の学習済みカーネル重みを `server/data/cnn/jgb_1d_cnn_results.json` に保存する（ランダムウォークに負ける区間も含め、ありのまま記録する）。

### Phase 2（実験結果の確認後）：MDX 2 章・R API・UI・検証

#### 1. 第 11 章（`ui/src/content/chapters/cnn-fundamentals.mdx`）
対象は大学学部〜実務クオンツ。厳密な添字式とバックワード勾配導出まで踏み込む。

- **11.1 そもそも CNN とは何か**：MLP との違い、局所受容野・重み共有・平行移動等変性／不変性。コラムとして金融工学の他の「畳み込み」（FFT 畳み込み法＝CONV/COS 法、CDO 離散損失分布の再帰畳み込み）との違いを整理。
- **11.2 1D / 2D 畳み込みの厳密な定式化（フォワードパス）**：数学的畳み込みと相互相関の違い、マルチチャネル・カーネル・ストライド・パディング・ダイレーションを含む厳密な添字式、出力サイズ公式、手計算できる小規模数値例、活性化関数・プーリング・残差接続・受容野。
- **11.3 バックワードパス（誤差逆伝播）の厳密な勾配導出**：連鎖律から、カーネル勾配 $\partial L/\partial W$ が入力と上流勾配の畳み込み（相互相関）、入力勾配 $\partial L/\partial x$ が空間反転カーネルとの full 畳み込み（転置畳み込み）になる導出（1D → 2D）。第 13 章「自動微分」への伏線（逆モード AD による自動化）。
- **11.4 実践実験：JGB イールドカーブの 1D-CNN 翌月予測と `rmql` 債券損益シナリオ**：
  - R API（例：`POST /api/cnn/jgb-forecast`）：選択年月と債券条件（残存年限・クーポン・額面など）を受け取り、当月実績・翌月実績・1D-CNN 予測・線形回帰予測の各カーブから **`rmql` で債券時価と予測／実績 P&L をリアルタイム計算**（`response.request_id` 付き）。
  - 画面コンポーネント（表示のみ）：年月スライダー＋債券条件操作、予測カーブ vs 翌月実績カーブの重ね描き、3 モデルの時系列誤差比較、学習済み 1D カーネル可視化、**`rmql` 債券時価・P&L 比較表**。
- **11.5 ヨーロピアンオプション・ボラティリティ曲面への CNN 応用**（解説のみ）：満期 $\times$ ストライク 2D 格子と画像処理の対応（1 次差分＝スキュー、2 次差分＝バタフライ）、高速サロゲート（Horvath–Muguruza–Tomas 型）、Deep Calibration（Hernandez 型）、無裁定条件（カレンダー／バタフライ）と外挿の限界。

#### 2. 第 12 章（`ui/src/content/chapters/cnn-applications.mdx`・解説のみ）
- **12.1 複雑金融モデルへの CNN 適用の共通設計**：入力テンソル設計、`rmql` 等による教師データ生成、面外検証・ストレス時フォールバック。
- **12.2 Hull–White モデルへの応用**：スワップション行列（2D）＋カーブ（1D）からの校正、第 8 章コール債の「状態 $\times$ コール日」格子上の継続価値・行使境界近似と大量シナリオ評価。
- **12.3 MBS への応用**：360 か月の金利履歴・バーンアウトに対する 1D-CNN の CPR 予測、OAS・ネガティブコンベクシティの高速サロゲート。
- **12.4 CLO / CDO トランシェへの応用**：Coral Book I-11 のトランシェ構造・離散損失畳み込み（Andersen–Sidenius–Basu 再帰）の整理、満期 $\times$ デタッチメントの 2D 相関曲面近似・大量シナリオ再評価サロゲート、数理的畳み込みと CNN 畳み込みの対比。
- **12.5 第 13 章「自動微分」への橋渡し**：CNN サロゲート vs 厳密な計算グラフのバックワード微分（AAD）の比較表。

#### 3. ルーティング・目次・検証
- `ui/src/components/icons.tsx`、`ui/src/book/toc.ts`（11.4 は `対応`、解説のみは `対象外`）、`ui/src/book/chapters.ts`、`ui/src/App.tsx`、`TocPage.tsx`、`README.md` を整合させる。
- `ui/` で `npm run build` と `npm test`（新 API のテスト追加含む）を実行して通過を確認し、報告してください。

---

## 3. 最初に着手すること

まず **Phase 1（JGB 1D-CNN 学習スクリプトの作成・実行、勾配チェックと 3 モデルの実測結果報告）** から着手してください。
