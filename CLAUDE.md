# Carmine-Studio（旧 LagrangeFinLab）

Carmine-Studio『エンタープライズ金融モデル』：Coral-Book『金融工学の応用基礎』の計算を、React で条件を操作しながら R サーバー上の rmql で評価する Web アプリ。三部作（Coral-Book・Carmine-Studio・Crimson Proof）の二冊目。ユーザーとのやり取りは日本語。設計の説明は `ui/src/content/introduction.mdx`（序論）と README の「設計の要点」。

## 実装時の役割分担

| 層 | 場所 | やること | やらないこと |
|---|---|---|---|
| 画面 | `ui/src/`（React、TypeScript、MDX。npm は `ui/` で実行） | 入力、API への非同期リクエスト、JSON の表示（本文・表・グラフ）、取得済みの結果の再利用 | 金融の計算（価格、カーブ、感応度など）。TypeScript で計算し直さない |
| API | `server/`（R、httpuv） | 入力の検査（不正は 400 と日本語のメッセージ）、`rmql` の呼び出し、JSON と `response.request_id` | 計算ロジックの実装。足りない計算は rmql に関数を足す |
| 計算エンジン | rmql リポジトリの `rmql`（Rust） | カーブ、評価、感応度、モンテカルロ、並列の一括評価 | — |

- **rmql の入れ方・更新・呼び方**は `../RiemannQL/docs/client_guide.md`。Windows では Rust なしで、`install.packages("rmql", repos = c("https://besuke.github.io/RiemannQL", "https://cloud.r-project.org"))`。入れ替える前に R API（8787）を止める。足りない計算は rmql の会話に頼む（共通のきまりは `../RiemannQL/CLAUDE.md`）。

- 新しい計算は、原稿（Coral-Book）または独立な計算と照合し、`server/tests/reconciliation/` に記録してから画面に出す。回帰テストは `ui/tests/`（Vitest、API を 8788 で起動）。
- ポート：画面は 8081（使用中なら止める、別ポートへ移らない）、開発用の R API は 8787。
- 並列：一台では Rust のスレッド（`compute_bond_values_batch` など）か `furrr::future_map()`。Slurm（`future.batchtools`）は構想で、未導入。
- ページの本文は原稿の内容に沿わせ、原稿と rmql の違いを前面に出さない（違いは照合記録へ）。
