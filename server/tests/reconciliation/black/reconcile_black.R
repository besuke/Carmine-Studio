# Reconcile the Black model chapter (Coral Book II-4): GaussQuant / QuantLib 1.42 running the manuscript's code
# against the page's own model (server/R/black_model.R, rmql), and that model against the manuscript's own
# results (rmql comparison/baseline/lagrange_values.csv). The inputs are the manuscript's illustrative values.
#
#   npm run reconcile:black
#
# Writes server/tests/golden/black_golden.json (GaussQuant's values) and server/tests/reconciliation/black/results/.

suppressPackageStartupMessages({ library(GaussQuant); library(QuantLib); library(rmql); library(jsonlite) })

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/black/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/black_model.R"))
t0 <- Sys.time()
api <- black_compute(list())
api_seconds <- as.numeric(Sys.time() - t0, units = "secs")

# ---- GaussQuant: the manuscript's code (II-4.1–4.6) ------------------------------------------------------------
trade_date <- GaussQuant::date_GQL("2023-07-21"); maturity_date <- GaussQuant::date_GQL("2023-08-26")
forward_price <- 107 + 6.75 / 32; strike_price <- 107.5; volatility <- 0.052; risk_free_rate <- 0.05
day_counter <- QuantLib::Actual365Fixed()
call_payoff <- QuantLib::PlainVanillaPayoff(QuantLib::Option_Call_get(), strike_price)
GaussQuant::set_eval_date_GQL(trade_date)
maturity <- day_counter$yearFraction(trade_date, maturity_date)
black_bundle <- GaussQuant::black_process_bundle_GQL(valuation_date = trade_date, forward = forward_price, risk_free_rate = risk_free_rate,
                                                     volatility = volatility, day_counter = day_counter)
discount_factor <- black_bundle$discount_curve$discount(maturity_date)
tbl_list <- function(t) stats::setNames(as.list(t$value), t$metric)
black_calc <- tbl_list(GaussQuant::black_calculator_table_GQL(payoff = call_payoff, forward = forward_price, volatility = volatility,
                                                             maturity = maturity, discount_factor = discount_factor))
european_call <- QuantLib::VanillaOption(call_payoff, QuantLib::EuropeanExercise(maturity_date))
european_call$setPricingEngine(QuantLib::AnalyticEuropeanEngine(black_bundle$process))
analytic <- tbl_list(GaussQuant::option_metric_table_GQL(option = european_call, process = black_bundle$process))
mc_path_tbl <- GaussQuant::generate_path_table_GQL(process = black_bundle$process, maturity = maturity, n_steps = 12L, n_paths = 200L, seed = 1L, sequence = "pseudo")
gq_mc <- GaussQuant::terminal_option_mc_GQL(path_tbl = mc_path_tbl, strike = strike_price, discount_factor = discount_factor, option_type = "call")$summary
gq_black_sobol <- GaussQuant::generate_path_table_GQL(process = black_bundle$process, maturity = maturity, n_steps = 3L, n_paths = 4L, seed = 1L, sequence = "sobol")

trade_date_bsm <- GaussQuant::date_GQL("2024-03-01"); calendar_bsm <- QuantLib::TARGET()
maturity_date_bsm <- calendar_bsm$advance(trade_date_bsm, 1L, "Years")
GaussQuant::set_eval_date_GQL(trade_date_bsm)
bsm_bundle <- GaussQuant::bsm_process_bundle_GQL(valuation_date = trade_date_bsm, spot = 100, risk_free_rate = 0.05, dividend_rate = 0,
                                                 volatility = 0.20, day_counter = day_counter, calendar = calendar_bsm)
european_put <- GaussQuant::make_european_option_GQL(spot = 100, strike = 100, maturity_date = maturity_date_bsm, option_type = "put",
  valuation_date = trade_date_bsm, risk_free_rate = 0.05, dividend_yield = 0, volatility = 0.20, day_counter = day_counter, calendar = calendar_bsm)
run_engines <- function(option, engines) vapply(engines, function(e) { option$setPricingEngine(e); option$NPV() }, 0)
gq_european <- run_engines(european_put, list(
  crr_25 = QuantLib::BinomialCRRVanillaEngine(bsm_bundle$process, 25L), analytic = QuantLib::AnalyticEuropeanEngine(bsm_bundle$process),
  crr_100 = QuantLib::BinomialCRRVanillaEngine(bsm_bundle$process, 100L), crr_500 = QuantLib::BinomialCRRVanillaEngine(bsm_bundle$process, 500L)))
american_put <- GaussQuant::make_american_option_GQL(spot = 100, strike = 100, maturity_date = maturity_date_bsm, option_type = "put",
  valuation_date = trade_date_bsm, risk_free_rate = 0.05, dividend_yield = 0, volatility = 0.20, day_counter = day_counter, calendar = calendar_bsm, steps = 500L)
gq_american <- run_engines(american_put, list(
  crr_25 = QuantLib::BinomialCRRVanillaEngine(bsm_bundle$process, 25L),
  barone_adesi_whaley = QuantLib::BaroneAdesiWhaleyApproximationEngine(bsm_bundle$process),
  bjerksund_stensland = QuantLib::BjerksundStenslandApproximationEngine(bsm_bundle$process),
  crr_500 = QuantLib::BinomialCRRVanillaEngine(bsm_bundle$process, 500L)))
maturity_bsm <- day_counter$yearFraction(trade_date_bsm, maturity_date_bsm)
sobol_display_tbl <- GaussQuant::generate_path_table_GQL(process = bsm_bundle$process, maturity = maturity_bsm, n_steps = 12L, n_paths = 64L, seed = 1L, sequence = "sobol")
lsm_path_tbl <- GaussQuant::generate_path_table_GQL(process = bsm_bundle$process, maturity = maturity_bsm, n_steps = 12L, n_paths = 2048L, seed = 1L, sequence = "sobol")
lsm_result <- GaussQuant::lsm_american_put_GQL(path_tbl = lsm_path_tbl, strike = 100, risk_free_rate = 0.05)
gq_lsm <- tbl_list(lsm_result$summary)
gq_exercise <- as.data.frame(dplyr::count(lsm_result$exercise, exercise_step, name = "paths"))
gq_diag <- as.data.frame(lsm_result$diagnostics)

# ---- comparisons -------------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  data.frame(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) data.frame(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA, pass = NA, note = note)
TREE_NOTE <- "二項ツリーは最大500ステップの後ろ向き計算で、演算順序の違いによる最下位ビットの差が積み上がる（最大 5e-12）"
bk <- api$black; pr <- bk$process; fm <- bk$formula
eu <- api$bsm$european_engines; am <- api$bsm$american_engines
api_ex <- api$lsm$exercise
gq_steps <- sort(unique(gq_exercise$exercise_step))
api_reg <- api$lsm$regressions[order(api$lsm$regressions$step), ]
gq_reg <- gq_diag[order(gq_diag$step), ]
rows <- rbind(
  cmp("Black76：満期までの年数", bk$time, maturity, 0),
  cmp("Black76：割引係数", bk$discount, discount_factor, 1e-15),
  cmp("Black76 公式：価格（BlackCalculator）", fm$value, black_calc$npv, 1e-13),
  cmp("Black76 公式：Delta（フォワード）", fm$delta_forward, black_calc$delta, 1e-13),
  cmp("Black76 公式：Gamma", fm$gamma_forward, black_calc$gamma, 1e-13),
  cmp("Black76 公式：Vega", fm$vega, black_calc$vega, 1e-12),
  cmp("Black76 process：価格（解析 Engine）", pr$value, analytic$npv, 1e-13),
  cmp("Black76 process：Delta", pr$delta, analytic$delta, 1e-13),
  cmp("Black76 process：Gamma", pr$gamma, analytic$gamma, 1e-13),
  cmp("Black76 process：Vega", pr$vega, analytic$vega, 1e-12),
  cmp("Black76 process：Theta", pr$theta, analytic$theta, 1e-12),
  cmp("Black76 process：Theta（1日）", pr$theta_per_day, analytic$theta_per_day, 1e-14),
  info("Black76：インプライド・ボラティリティ", bk$implied_volatility, analytic$implied_volatility,
       "判定しない：QuantLib の既定の精度は 1e-4、rmql は 1e-10（入力 5.2% を再現する）"),
  info("MC：疑似乱数 200 パスの価格（rmql − QuantLib MT）", api$mc$npv, gq_mc$npv,
       sprintf("判定しない：乱数が別。差は標準誤差の %.2f 倍", (api$mc$npv - gq_mc$npv) / gq_mc$standard_error)),
  cmp("1パスの確認：Sobol 3ステップ×4本のパス（RFM−GQ）", api$mc$one_path$generated_price,
      gq_black_sobol$price[gq_black_sobol$path_id %in% 2:4], 1e-12),
  cmp("1パスの確認：生成パス − 手計算", api$mc$one_path$difference, 0, 1e-8,
      "手計算の Z は R の qnorm、パス生成は QuantLib と同じ逆正規近似（相対精度 1e-9 程度）。差はその近似誤差"),
  cmp("BSM：満期までの年数", api$bsm$time, maturity_bsm, 1e-16),
  cmp("European put：CRR 25・解析・CRR 100・CRR 500", eu$npv, gq_european[eu$method], 1e-10, TREE_NOTE),
  cmp("American put：CRR 25・BAW・BjS・CRR 500", am$npv, gq_american[am$method], 1e-10, TREE_NOTE),
  cmp("Sobol：64本×13点のパス", api$lsm$shown_paths$price, sobol_display_tbl$price, 1e-11),
  cmp("LSM：価格", api$lsm$value, gq_lsm$lsm_npv, 1e-12),
  cmp("LSM：標準誤差", api$lsm$standard_error, gq_lsm$standard_error, 1e-12),
  cmp("LSM：行使ステップごとのパス数", api_ex$paths_in_table[match(gq_steps, api_ex$step)], gq_exercise$paths, 0),
  cmp("LSM：各ステップの ITM パス数", api_reg$in_the_money_paths, gq_reg$in_the_money_paths, 0),
  cmp("LSM：各ステップの行使パス数", api_reg$exercised_paths, gq_reg$exercised_paths, 0),
  cmp("LSM：各ステップの即時行使価値の平均", api_reg$mean_immediate_value, gq_reg$mean_immediate_value, 1e-12),
  cmp("原稿：Black76 価格", pr$value, bv("black.npv"), 1e-13),
  cmp("原稿：Black76 Delta", pr$delta, bv("black.delta"), 1e-13),
  cmp("原稿：Black76 Gamma", pr$gamma, bv("black.gamma"), 1e-13),
  cmp("原稿：Black76 Vega", pr$vega, bv("black.vega"), 1e-12),
  cmp("原稿：Black76 Theta", pr$theta, bv("black.theta"), 1e-12),
  cmp("原稿：Black76 Theta（1日）", pr$theta_per_day, bv("black.theta_per_day"), 1e-14),
  cmp("原稿：European put 解析", eu$npv[eu$method == "analytic"], bv("tree.european.analytic"), 1e-12),
  cmp("原稿：European put CRR 25・100・500", eu$npv[eu$method != "analytic"], bv(paste0("tree.european.", eu$method[eu$method != "analytic"])), 1e-10, TREE_NOTE),
  cmp("原稿：American put CRR 25・BAW・BjS・CRR 500", am$npv, bv(paste0("tree.american.", am$method)), 1e-10, TREE_NOTE),
  cmp("原稿：Sobol 64本のパスの合計", api$lsm$first_paths_sum, bv("sobol.first_paths_sum"), 1e-9),
  cmp("原稿：LSM 価格", api$lsm$value, bv("lsm.npv"), 1e-12),
  cmp("原稿：LSM 標準誤差", api$lsm$standard_error, bv("lsm.standard_error"), 1e-12),
  cmp("原稿：LSM 行使ステップごとのパス数（2〜12）", api_ex$paths_in_table[api_ex$step >= 2], bv(paste0("lsm.exercise_paths.", api_ex$step[api_ex$step >= 2])), 0),
  cmp("原稿：LSM 回帰で行使したパス数（1〜11）", api_reg$exercised_paths, bv(paste0("lsm.exercised_in_regression.", api_reg$step)), 0),
  info("原稿：MC 価格（疑似乱数 200 パス）", api$mc$npv, bv("mc.npv"),
       sprintf("判定しない：乱数が別。差は原稿の標準誤差 %.4f の %.2f 倍", bv("mc.standard_error"), (api$mc$npv - bv("mc.npv")) / bv("mc.standard_error")))
)
rownames(rows) <- NULL
options(width = 220)
print(rows[, c("item", "n", "max_abs_diff", "tolerance", "pass")], digits = 3)
cat("\n"); for (i in which(nzchar(rows$note))) cat(rows$item[i], "：", rows$note[i], "\n")
cat(sprintf("\nAPI の計算時間（既定の入力、初回）：%.2f 秒\n", api_seconds))
utils::write.csv(rows, file.path(out_dir, "black_diffs.csv"), row.names = FALSE)
golden <- list(
  engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib 1.42"),
  black_calculator = black_calc, analytic = analytic, mc_pseudo_quantlib = as.list(gq_mc),
  black_sobol_3x4 = gq_black_sobol$price,
  european = as.list(gq_european), american = as.list(gq_american),
  sobol_64_paths = sobol_display_tbl$price, lsm = gq_lsm, lsm_exercise = gq_exercise, lsm_diagnostics = gq_diag
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/black_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), golden$engine, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
