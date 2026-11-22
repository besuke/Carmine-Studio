export type Coverage = "対応" | "一部" | "未対応" | "対象外";

export interface SectionRow {
  sections: string;
  topic: string;
  coverage: Coverage;
  rmql: string;
}

export interface Chapter {
  id: string;
  title: string;
  source: string;
  operations: string[];
  rows: SectionRow[];
  additions: string[];
  route?: string;
  menu?: string;
  subRoutes?: { route: string; title: string; menu?: string }[];
  routeNote?: string;
}

export interface Part {
  id: string;
  title: string;
  menu?: string;
  chapters: Chapter[];
}

export const BOOK_TITLE = "金融工学の応用基礎";

export const TOC: Part[] = [
  {
    id: "arbitrage-free",
    title: "無裁定モデル",
    menu: "無裁定モデル",
    chapters: [
      {
        id: "II-1",
        title: "確定キャッシュフロー",
        source: "part2_quantive_riemann/ch01_deterministic_cashflow.qmd",
        route: "/deterministic-cashflow",
        routeNote: "債券のキャッシュフロー、単利・複利利回りと単価、Zスプレッド、金利感応度指標（BPV・デュレーション・コンベクシティ）、複利利回りの数値解法を操作できます",
        operations: [
          "利回りを動かして、単価・経過利子・デュレーション・コンベクシティ・BPVの変化を見る",
          "クーポンと残存年数を変えて、価格と利回りの関係（凸性）を描く",
          "パーレート・ゼロ金利・フォワードの三つの曲線を重ねて比べる",
        ],
        rows: [
          { sections: "1.1〜1.2", topic: "パーレート、割引係数、スポット、フォワード", coverage: "対応", rmql: "OISブートストラップ、割引係数・ゼロ金利・フォワード算出" },
          { sections: "1.3〜1.5", topic: "固定利付債、キャッシュフロー、単利・複利利回りと単価", coverage: "対応", rmql: "固定利付債キャッシュフロー展開、単利・複利・単価換算" },
          { sections: "1.6〜1.7", topic: "カーブ評価、Zスプレッド、ASW、デュレーション、BPV", coverage: "対応", rmql: "カーブ上の債券評価、Zスプレッド逆算、デュレーション・コンベクシティ・BPV" },
          { sections: "1.8", topic: "複利利回りの数値解法の比較", coverage: "対応", rmql: "ニュートン法、二分法、Brent法、多項式求根の反復・速度比較" },
        ],
        additions: [],
      },
      {
        id: "II-2",
        title: "金利カーブ・CTD",
        menu: "金利カーブ・CTD",
        source: "part2_quantive_riemann/ch02_interest_rate_curves.qmd",
        operations: [
          "ゼロ金利ノードを編集して、割引係数・ゼロ金利・フォワードの3曲線を横並びで比較する",
          "ゼロ金利補間（ZeroCurve）と割引係数補間（DiscountCurve）を重ね、フォワードの形の違いを見る。平行シフトの幅を変える",
          "国債先物の受渡適格銘柄の Basis・Implied Repo・CTD と先物BPV を見る。利回り水準と Funding Rate を動かし、CTD の入れ替わりを見る",
        ],
        rows: [
          { sections: "2.1", topic: "国債利回りの年限・時間方向の変化（月末のカーブ、年月スライダーと再生）", coverage: "対応", rmql: "単調対数3次補間による月末JGBカーブ構築（財務省の国債金利情報）" },
          { sections: "2.2〜2.3", topic: "ゼロカーブ、割引係数カーブ、補間方式とフォワード金利", coverage: "対応", rmql: "ZeroCurve・DiscountCurveの構築と割引係数・ゼロ金利・フォワードの比較" },
          { sections: "2.5", topic: "平行シフトとカーブ検証", coverage: "対応", rmql: "ゼロ金利スプレッド加算とノード再現性・グリッド検証" },
          { sections: "2.6〜2.7", topic: "国債先物、Gross・Net Basis、CTD、先物BPV", coverage: "対応", rmql: "受渡適格銘柄バスケット評価、Basis・Implied Repo・CTD・先物BPV算出" },
        ],
        additions: [],
        route: "/yield-curves",
        routeNote: "ゼロ金利ノード、補間方式（ZeroCurve / DiscountCurve）、平行シフト、および国債利回りの期間構造の推移を操作できます。国債先物・CTDは章冒頭から操作できます",
      },
      {
        id: "II-3",
        menu: "OISスワップ",
        title: "OISスワップとマルチカーブ評価",
        source: "part2_quantive_riemann/ch03_ois_swaps_multicurve.qmd",
        operations: [
          "円TONA OISカーブを構築し、5年クォート＋1 bp とリセットで、割引係数・ゼロ金利・フォワードの3グラフと7年OISの時価の変化を見る",
          "OISアセットスワップ（通貨別OISカーブ、円ベーシス込みASW）を評価する",
        ],
        rows: [
          { sections: "3.1〜3.3", topic: "TONA OIS カーブ構築、フェアレート、日次複利、キャッシュフロー", coverage: "対応", rmql: "OISカーブのブートストラップ（単調対数3次スプライン補間）、スワップ時価・明細算出" },
          { sections: "3.4", topic: "SOFR OIS カーブ、マルチカーブ評価", coverage: "対応", rmql: "予測カーブと割引カーブを分離したOIS評価" },
          { sections: "3.7", topic: "4通貨 OIS カーブ、OIS アセットスワップ、円ベーシス込み ASW", coverage: "対応", rmql: "通貨別OISカーブ構築とアセットスワップスプレッド算出" },
        ],
        additions: [],
        route: "/yield-curve-ois",
        routeNote: "円TONA OISカーブの構築（単調対数3次スプライン補間）と、市場レート変動による割引係数・ゼロ金利・1暦日フォワードおよび7年OISスワップの評価損益の変化を操作できます",
      },
      {
        id: "II-4",
        title: "ブラックモデル",
        source: "part2_quantive_riemann/ch04_black_model.qmd",
        route: "/black-model",
        routeNote: "Black 76・BSMの価格とグリークス、モンテカルロの収束とパス分布、アメリカン・オプションの早期行使価値（二項ツリー・各種近似・Longstaff–Schwartz法）を操作できます",
        operations: [
          "原資産・権利行使価格・ボラティリティ・満期を動かして、Black76 と BSM の価格とグリークスを見る",
          "パス数と乱数（疑似乱数・Sobol）を変えて、モンテカルロの収束と標準誤差、パスと満期分布を見る",
          "アメリカン put の早期行使価値（二項ツリー・近似式・Longstaff–Schwartz法）を比べる",
        ],
        rows: [
          { sections: "4.1〜4.3", topic: "Black76、BSM の価格とグリークス、二項ツリー", coverage: "対応", rmql: "先物オプション・ヨーロピアンオプション解析解、CRR二項ツリー" },
          { sections: "4.4", topic: "モンテカルロ評価とパス分布", coverage: "対応", rmql: "疑似乱数・Sobol列によるパス生成と価格収束" },
          { sections: "4.5", topic: "アメリカン put の早期行使価値", coverage: "対応", rmql: "CRR二項ツリー、Barone–Adesi–Whaley近似、Bjerksund–Stensland近似" },
          { sections: "4.6", topic: "Sobol 列、Longstaff–Schwartz 法（LSM）", coverage: "対応", rmql: "準モンテカルロと多項式回帰による早期行使境界・価格算出" },
        ],
        additions: [],
      },
      {
        id: "II-5",
        title: "信用リスクとCDS",
        source: "part2_quantive_riemann/ch05_credit_risk_cds.qmd",
        route: "/credit-cds",
        routeNote: "ハザードレートの推定と感応度、CDSの各レグ・NPV・Fair Spread・Fair Upfrontの算出、MidPoint法とISDA標準モデルの比較を操作できます",
        operations: [
          "市場 Spread・契約 Coupon・回収率・割引率を動かして、Premium Leg・Protection Leg・Fair Spread・Fair Upfront を見る",
          "ゼロ NPV のハザードレートを推定し、単純近似 s/(1−R) と比べる。Spread と回収率の感応度表を確認する",
          "支払日ごとのキャッシュフロー表から手計算し、MidPoint法・ISDA標準モデルと比べる",
        ],
        rows: [
          { sections: "5.1〜5.4", topic: "生存確率、MidPoint法、各レグ評価、ハザードレートの推定と感応度", coverage: "対応", rmql: "ハザードカーブ構築、MidPoint評価、スプレッド・回収率感応度" },
          { sections: "5.2.5、5.6.4", topic: "CDS の支払日ごとのキャッシュフロー表と確率表", coverage: "対応", rmql: "支払日ごとの割引係数・生存確率・中点近似明細" },
          { sections: "5.5〜5.6", topic: "標準 CDS（CDS2015）、ISDA Engine、Fair Upfront", coverage: "対応", rmql: "IMM日付・CDS2015満期規則、ISDA標準モデル評価とUpfront算出" },
        ],
        additions: [],
      },
      {
        id: "II-6",
        menu: "キャリブレーション",
        title: "金利デリバティブのキャリブレーション",
        source: "part2_quantive_riemann/ch06_irs_calibration.qmd",
        route: "/irs-calibration",
        routeNote: "Normal・Blackボラティリティの比較、SABRモデルのスマイル校正、Hull–Whiteモデルのパラメータ推定、BGMモデルの相関推定を操作できます",
        operations: [
          "SABR の β を変えて市場スマイルへの当てはまりと最適化手法による推定値の違いを見る",
          "Black 型と Normal 型のボラティリティを換算して比べる",
          "Hull–White の a と σ を校正し、適合点と検証用（面外）債券オプション価格の再現を見る",
        ],
        rows: [
          { sections: "6.2〜6.4", topic: "Normal ボラティリティ、SABR スマイル校正、Hull–White パラメータ推定", coverage: "対応", rmql: "Bachelier評価、SABR校正、Hull–White債券オプション評価と校正" },
          { sections: "6.5", topic: "BGM のキャップレットと相関減衰の推定（Rebonato近似）", coverage: "対応", rmql: "固定ウェイト近似・Rebonato近似によるスワップションボラと相関減衰推定" },
        ],
        additions: [],
      },
      {
        id: "II-7",
        title: "金利モデル",
        source: "part2_quantive_riemann/ch07_irs_rate_models.qmd",
        route: "/rate-models",
        routeNote: "Hull–Whiteモデルの短期金利シミュレーション、LMMキャップレット価格と相関ショック、後決め金利（FMM）の評価を操作できます",
        operations: [
          "Hull–White の a と σ を動かして、短期金利の経路・分位点帯と HJM 瞬間フォワード変動係数を描く",
          "LMM のキャップレット価格と満期フォワード分布、相関ショックの散布図を見る",
          "後決め金利（FMM）のキャップレットと日次複利の確定過程を見る",
        ],
        rows: [
          { sections: "7.2〜7.3", topic: "Hull–White 短期金利経路、割引係数の再現確認、HJM フォワード係数", coverage: "対応", rmql: "OU過程の遷移シミュレーションと初期割引曲線の再現検証" },
          { sections: "7.4〜7.5", topic: "LMM キャップレット、相関ショック生成、FMM と後決め複利金利", coverage: "対応", rmql: "前決め・後決めキャップレット評価、コレスキー分解による相関乱数生成" },
        ],
        additions: [],
      },
      {
        id: "II-8",
        title: "早期償還モデル",
        source: "part2_quantive_riemann/ch08_early_redemption_models.qmd",
        route: "/early-redemption",
        routeNote: "コール条項付債券のバックワード・インダクションによる行使判断、MBSのプリペイメント（PSA）とOASを操作できます",
        operations: [
          "Hull–White のパラメータと金利水準を動かして、コール債の価格とコールオプション価値を見る",
          "コール日ごとの行使判断（コールする短期金利の上限）と、ボラティリティによるコール権の価値の変化を見る",
          "PSA・借換え感応度・コストを動かして、MBS の CPR・キャッシュフロー・加重平均残存年数・OAS を見る",
        ],
        rows: [
          { sections: "8.1〜8.7", topic: "コール条項付債券、バックワード・インダクション、行使境界、格子収束", coverage: "対応", rmql: "状態格子とGauss–Hermite求積によるCallable債評価・行使境界算出" },
          { sections: "8.8", topic: "MBS のプリペイメント（PSAモデル）と OAS", coverage: "対応", rmql: "CPR/SMMモデルによるMBSキャッシュフロー展開、金利経路評価、OAS算出" },
        ],
        additions: [],
      },
      {
        id: "II-9",
        menu: "PRDC",
        title: "金利為替系デリバティブ（PRDC）",
        source: "part2_quantive_riemann/ch09_exotic_derivatives_prdc.qmd",
        route: "/prdc",
        routeNote: "FXスポット・ボラティリティ・金利・クーポンの条件を変え、PRDCの現在価値、FX感応度、期待クーポンや到達確率を操作できます",
        operations: [
          "FX スポット・ボラティリティ・金利とクーポンの条件を動かして、PRDC の現在価値と FX デルタ・ベガを見る。モンテカルロのパス数で標準誤差を見る",
          "期待クーポンの期間構造、キャップ・フロアへの到達確率、3時点のクーポン分布を横並びで比べる",
        ],
        rows: [
          { sections: "9.1〜9.3", topic: "契約条件、FX 過程、クーポンペイオフ、閉形式とモンテカルロの現在価値", coverage: "対応", rmql: "スケジュール生成、Garman–Kohlhagen過程、PRDC現在価値評価" },
          { sections: "9.4〜9.5", topic: "期待クーポンの期間構造、到達確率、クーポン分布、FX スポット・ボラ感応度", coverage: "対応", rmql: "各クーポン日のオプション分解評価と感応度シナリオ算出" },
        ],
        additions: [],
      },
    ],
  },
  {
    id: "enterprise",
    title: "エンタープライズ計算",
    menu: "エンタープライズ",
    chapters: [
      {
        id: "III-1",
        menu: "並列計算",
        title: "並列計算",
        route: "/enterprise/parallel-computing",
        routeNote: "債券の一括評価の測定や、モンテカルロ・シミュレーションのスレッド数を変えて並列計算の効果を測定・操作できます",
        source: "part3_enterprise_riemann/ch01_computational_evolution_parallel.qmd",
        operations: ["件数とスレッド数を選んで、債券の一括評価やPRDCモンテカルロの並列計算時間をサーバーで測る"],
        rows: [
          { sections: "1.1〜1.4", topic: "金融と情報工学の歩み、ハードウェアの限界、独立タスクへの分割", coverage: "対応", rmql: "シナリオごとの独立タスク評価と解説" },
          { sections: "1.5〜1.6", topic: "マルチスレッドによる並列一括評価とスピードアップの計測", coverage: "対応", rmql: "スレッド数別の債券バッチ評価・モンテカルロ計測と結果一致確認" },
        ],
        additions: [],
      },
      {
        id: "III-2",
        menu: "分散計算",
        title: "分散計算",
        route: "/enterprise/distributed-jobs",
        routeNote: "シナリオをジョブに分割して計算サーバーへ送り、集約する分散計算の流れを操作できます",
        source: "part3_enterprise_riemann/ch02_distributed_computing_jobtask.qmd",
        operations: ["1ジョブのシナリオ数と同時送信数を変えて、45シナリオの格子をジョブ分割・非同期実行・集約する"],
        rows: [
          { sections: "2.1〜2.5", topic: "タスク分割、ジョブキュー、スケジューリング、実行状態の追跡", coverage: "対応", rmql: "ブラウザスケジューラーと計算APIによる非同期ジョブ実行・レーン可視化" },
        ],
        additions: [],
      },
      {
        id: "III-3",
        menu: "計算アーキテクチャ",
        title: "金融計算アーキテクチャ",
        route: "/enterprise/distributed-jobs",
        routeNote: "シナリオ格子を一括評価し、PRDCのリスク集計を行う金融計算アーキテクチャを操作できます",
        source: "part3_enterprise_riemann/ch03_enterprise_financial_computing.qmd",
        operations: ["シナリオ格子の評価結果をリアルタイムにマトリクス集計する"],
        rows: [
          { sections: "3.1〜3.5", topic: "取引・市場データ分離、シナリオ格子の並列評価とリスク集計", coverage: "対応", rmql: "スポット×ボラティリティ格子のジョブ評価と平均現在価値のリアルタイム集計" },
        ],
        additions: [],
      },
      {
        id: "CNN-1",
        menu: "CNN の基礎と実践",
        title: "CNN の基礎と実践（JGB カーブ予測・ヨーロピアン）",
        route: "/enterprise/cnn-fundamentals",
        routeNote: "畳み込みのフォワードとバックワードの式から、国債カーブの翌月予測（1D-CNN とランダムウォーク・リッジ回帰の比較）と、予測したカーブでの債券の損益を rmql で評価するところまで、操作して確かめられます",
        source: "Carmine-Studio の独自の章（Coral-Book に対応する章はない）",
        operations: [
          "予測の起点の月と債券の条件（残存年限・クーポン・額面）を選び、1D-CNN・リッジ回帰の予測カーブと翌月の実績のカーブを重ねて見る",
          "債券を各カーブで評価した価値と損益（rmql）を、実績と比べる",
          "ランダムウォーク・リッジ回帰・1D-CNN の予測誤差（RMSE と MAE）を、期間別・年限別に比べ、学習したカーネルを見る",
        ],
        rows: [
          { sections: "11.1〜11.3", topic: "CNN の考え方、1D・2D 畳み込みの式（フォワード）、勾配の導出（バックワード）", coverage: "対象外", rmql: "解説（式と導出）。実験のスクリプトが数値勾配で確かめる" },
          { sections: "11.4", topic: "JGB カーブの 1D-CNN による翌月予測と、債券の損益シナリオ", coverage: "対応", rmql: "月末 442 か月のウォークフォワード評価（オフライン学習）と、予測・実績のカーブでの債券評価（rmql）" },
          { sections: "11.5", topic: "ヨーロピアン・オプションのボラティリティ曲面への応用", coverage: "対象外", rmql: "解説のみ" },
        ],
        additions: [],
      },
      {
        id: "CNN-2",
        menu: "CNN の金融モデル応用",
        title: "CNN の金融モデル応用（Hull–White・MBS・CLO）",
        route: "/enterprise/cnn-applications",
        routeNote: "Hull–White、MBS、CLO・CDO のトランシェを CNN で近似する場合の設計と、自動微分との比較を解説します",
        source: "Carmine-Studio の独自の章（Coral-Book に対応する章はない）",
        operations: ["解説のみ（画面での計算はありません）"],
        rows: [
          { sections: "12.1", topic: "複雑なモデルへの CNN 適用の共通の設計（入力、教師データ、範囲外の検証、フォールバック）", coverage: "対象外", rmql: "解説のみ" },
          { sections: "12.2〜12.4", topic: "Hull–White、MBS、CLO・CDO のトランシェへの応用", coverage: "対象外", rmql: "解説のみ。教師データには rmql の評価を使う想定" },
          { sections: "12.5", topic: "CNN のサロゲートと自動微分（AAD）の比較", coverage: "対象外", rmql: "解説のみ" },
        ],
        additions: [],
      },
      {
        id: "LC-1",
        menu: "ルックバック・転換社債・MSCB",
        title: "ルックバック・転換社債・MSCB（持ち越す状態と次元の縮約）",
        route: "/enterprise/lookback-convertible",
        routeNote: "ルックバックの最小値と、MSCB の転換価額を、持ち越す状態として扱い、次元を縮約して評価します",
        source: "Carmine-Studio の独自の章（Coral-Book に対応する章はない）",
        operations: ["ルックバック、転換社債、MSCB を rmql で評価し、グリークスと収束を確かめる（ライブの計算と、事前計算の表）"],
        rows: [
          { sections: "13.1", topic: "状態の問い：ヨーロピアンの比 S/K から、ルックバックの最小値、MSCB の転換価額へ", coverage: "対応", rmql: "解説" },
          { sections: "13.2", topic: "ルックバック：連続監視の閉じた式と、離散監視の木", coverage: "対応", rmql: "compute_lookback_option_value、compute_discrete_lookback_option_value" },
          { sections: "13.3", topic: "転換社債：価値と転換確率の格子", coverage: "対応", rmql: "compute_convertible_bond_value" },
          { sections: "13.4", topic: "転換時にリセットする MSCB", coverage: "対応", rmql: "compute_reset_convertible_bond_value" },
          { sections: "13.5", topic: "転換価額を持ち越す MSCB：2 次元の格子と 1 次元の縮約", coverage: "対応", rmql: "compute_carried_reset_convertible_bond_value" },
        ],
        additions: [],
      },
      {
        id: "MP-1",
        menu: "MBS・PRDC",
        title: "MBS・PRDC（縮約できない経路依存）",
        route: "/enterprise/mbs-prdc",
        routeNote: "MBS の元本残高と、PRDC の累積クーポンを、経路ごとに持ち越して評価します（PRDC の評価は 14.1 から操作できます）",
        source: "Carmine-Studio の独自の章（Coral-Book に対応する章はない）",
        operations: ["MBS の残高・CPR・価格・OAS と、PRDC の TARN・ノックアウトを rmql で評価する（ライブの計算と、事前計算の表）"],
        rows: [
          { sections: "14.1", topic: "PRDC（Coral-Book II-9 の画面）", coverage: "対応", rmql: "PRDC の評価（下の II-9 の表）" },
          { sections: "14.2〜14.3", topic: "MBS：期限前返済と残高の経路、OAS と経路の数", coverage: "対応", rmql: "compute_mbs_cashflows、compute_mbs_path_values、compute_mbs_oas" },
          { sections: "14.4", topic: "PRDC の状態：TARN、ノックアウト", coverage: "対応", rmql: "compute_prdc_three_factor_value" },
        ],
        additions: [],
      },
      {
        id: "III-4",
        menu: "自動微分",
        title: "自動微分計算",
        route: "/enterprise/automatic-differentiation",
        routeNote: "有限差分（Bump & Revalue）と自動微分の計算速度・精度の違いを比較できます",
        source: "part3_enterprise_riemann/ch04_automatic_differentiation.qmd",
        operations: ["12個のリスクファクターに対する感応度を自動微分（1回）と有限差分（24回）で計算し、速度と精度を比べる"],
        rows: [
          { sections: "4.1〜4.4", topic: "有限差分法と自動微分（AAD）の原理・計算回数の比較", coverage: "対応", rmql: "計算グラフの逆伝播による全感応度一括算出と中心差分との比較" },
        ],
        additions: [],
      },
      {
        id: "III-5",
        menu: "自動微分：オプション",
        title: "自動微分応用：オプション",
        route: "/enterprise/automatic-differentiation",
        routeNote: "解析解とモンテカルロ＋自動微分によるオプションのGreeks計算を操作できます",
        source: "part3_enterprise_riemann/ch05_option_greeks_autodiff.qmd",
        operations: ["パスごとの自動微分（Pathwise AAD）によるモンテカルロ感応度と閉形式の値を比較する"],
        rows: [
          { sections: "5.1〜5.4", topic: "解析解とモンテカルロ自動微分のグリークス、非線形ペイオフの扱い", coverage: "対応", rmql: "パスごとの自動微分によるDelta・Vega算出と閉形式との比較" },
        ],
        additions: [],
      },
      {
        id: "III-6",
        menu: "自動微分：金利リスク",
        title: "自動微分応用：金利リスク",
        route: "/enterprise/automatic-differentiation",
        routeNote: "カーブ節点感応度（バケットDV01）の自動微分計算を操作できます",
        source: "part3_enterprise_riemann/ch06_interest_rate_risk_autodiff.qmd",
        operations: ["円金利・外貨金利カーブの各年節点に対する感応度（DV01）を棒グラフと表で確認する"],
        rows: [
          { sections: "6.1〜6.4", topic: "カーブ節点に対する感応度（バケット DV01）の自動微分算出", coverage: "対応", rmql: "円カーブ・外貨カーブ各節点の感応度算出と可視化" },
        ],
        additions: [],
      },
      {
        id: "III-7",
        menu: "自動微分：多因子",
        title: "自動微分応用：多因子モデル",
        route: "/enterprise/automatic-differentiation",
        routeNote: "多因子モデルにおけるPRDCの感応度一括計算を操作できます",
        source: "part3_enterprise_riemann/ch07_prdc_autodiff.qmd",
        operations: ["FXスポット・ボラティリティ・2通貨カーブ節点の感応度を自動微分で一度に求める"],
        rows: [
          { sections: "7.1〜7.5", topic: "多因子PRDCモデル、全感応度の一括算出、非線形クーポンの自動微分", coverage: "対応", rmql: "PRDCのFX・ボラティリティ・カーブ節点感応度の自動微分評価" },
        ],
        additions: [],
      },
    ],
  },
];
