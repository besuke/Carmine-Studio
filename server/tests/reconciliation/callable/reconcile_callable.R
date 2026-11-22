# Reconcile the early redemption chapter (Coral Book II-8): the manuscript's R functions against the page's own
# model (server/R/callable_model.R, rmql), and that model against the manuscript's own results (rmql
# comparison/baseline/lagrange_values.csv).
#
#   npm run reconcile:callable
#
# Writes server/tests/golden/callable_golden.json (the manuscript's functions' values) and server/tests/reconciliation/callable/results/.

suppressPackageStartupMessages({
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/callable/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/callable_model.R"))
api <- callable_compute(list())

# ---- the manuscript's R functions, taken from the manuscript itself -------------------------------------------------
qmd <- "C:/AnalyticFin/Projects/Coral-Book/part2_quantive_riemann/ch08_early_redemption_models.qmd"
lines <- readLines(qmd, encoding = "UTF-8")
chunk_code <- function(label) {
  start <- grep(sprintf("^#\\| label: %s$", label), lines)
  stopifnot(length(start) == 1L)
  end <- start + which(lines[(start + 1):length(lines)] == "```")[1]
  lines[(start + 1):(end - 1)]
}
ms <- new.env()
ms$show_early_redemption_tbl_LRL <- function(...) invisible(NULL)
ms$add_lagrange_theme_LFL <- function(p, ...) p
ms$print <- function(...) invisible(NULL)
for (label in c("early-redemption-contract", "early-redemption-bullet", "hull-white-conditional-discount", "callable-hull-white-backward",
                "callable-volatility-sensitivity", "callable-grid-convergence", "mbs-prepayment-cashflows", "mbs-hull-white-paths",
                "mbs-static-psa-oas")) {
  code <- chunk_code(label)
  code <- code[!grepl("^#\\|", code)]
  # the figures in these chunks are built but not drawn (print and the theme are stubbed above)
  eval(parse(text = code), envir = ms)
}

# ---- comparisons -----------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA_real_, pass = NA, note = note)
b <- api$bond; m <- api$mbs
ms_dec <- ms$model_result$decisions
api_dec <- cb_decisions(cb_flows(CB_DEFAULTS$bond), 0.15, 0.012, rmql::create_flat_curve(CB_CURVE_DATE, 0.02, "actual_365_fixed", "continuous"))$decisions
scen_ms <- ms$tbl_mbs_scenarios
static_ms <- ms$tbl_psa_oas |> arrange(psa_percent, assumed_price)
static_api <- api$static$table |> arrange(psa_percent, assumed_price)
rows <- bind_rows(
  cmp("Bullet（初期曲線）", b$bullet_from_curve, ms$bullet_curve_price, 1e-13),
  cmp("Bullet（格子）RFM − 原稿の関数", b$bullet, ms$model_result$bullet_price, 1e-12),
  cmp("Callable RFM − 原稿の関数", b$callable, ms$model_result$callable_price, 1e-12),
  cmp("コール権の価値 RFM − 原稿の関数", b$issuer_call_value, ms$model_result$issuer_call_value, 1e-12),
  cmp("コール判断の表（継続価値、8日 × 321点）", api_dec$continuation_ex_coupon, ms_dec$continuation_ex_coupon, 1e-12),
  cmp("コール判断の表（行使するか）", as.numeric(api_dec$exercise_now), as.numeric(ms_dec$exercise_now), 0),
  cmp("ボラティリティ別の Callable（0・0.6・1.2・2%）", b$by_volatility$callable, ms$tbl_volatility_sensitivity$callable_price, 1e-12),
  cmp("格子・求積点別の Callable（161・321・641）", b$grid_convergence$callable, ms$tbl_grid_convergence$callable_price, 1e-12),
  cmp("MBS シナリオ：加重平均残存年数", m$scenarios$weighted_average_life, scen_ms$weighted_average_life, 1e-12),
  cmp("MBS シナリオ：固定 4% の価格", m$scenarios$price_fixed_discount, scen_ms$price_fixed_discount, 1e-11),
  cmp("MBS シナリオ：経路の金利の価格", m$scenarios$price_path_discount, scen_ms$price_path_discount, 1e-11),
  cmp("MBS シナリオ：元本の合計", m$scenarios$total_principal, scen_ms$total_principal, 1e-11),
  cmp("MBS：Hull–White の20経路の金利", unlist(m$paths$rates), as.vector(t(ms$mbs_short_rates)), 0),
  cmp("MBS：20経路の価格", m$paths$price, ms$tbl_mbs_mc$price, 1e-11),
  cmp("MBS：20経路の加重平均残存年数", m$paths$weighted_average_life, ms$tbl_mbs_mc$weighted_average_life, 1e-12),
  info("静的 OAS（bp）RFM − 原稿の uniroot", static_api$oas_bp, static_ms$oas_bp,
       "判定しない：原稿の uniroot は既定の許容誤差（スプレッドで約 1.2e-4）で止まる。RFM は 1e-12"),
  cmp("原稿：Bullet・Callable・コール権", c(b$bullet, b$callable, b$issuer_call_value), c(bv("callable.bullet"), bv("callable.callable"), bv("callable.call_value")), 1e-12),
  cmp("原稿：ボラティリティ別の Callable", b$by_volatility$callable, bv(sprintf("callable.volatility.%g", b$by_volatility$volatility)), 1e-12),
  cmp("原稿：格子別の Callable", b$grid_convergence$callable, bv(sprintf("callable.grid.%d", b$grid_convergence$points)), 1e-12),
  cmp("原稿：MBS シナリオの加重平均残存年数", m$scenarios$weighted_average_life, bv(sprintf("mbs.scenario.wal.%d", 1:3)), 1e-12),
  cmp("原稿：MBS シナリオの価格（固定・経路）", c(m$scenarios$price_fixed_discount, m$scenarios$price_path_discount),
      bv(c(sprintf("mbs.scenario.price_fixed.%d", 1:3), sprintf("mbs.scenario.price_path.%d", 1:3))), 1e-11),
  cmp("原稿：MBS 20経路の価格", m$paths$price, bv(sprintf("mbs.path.price.%d", 1:20)), 1e-11),
  cmp("原稿：MBS 20経路の加重平均残存年数", m$paths$weighted_average_life, bv(sprintf("mbs.path.wal.%d", 1:20)), 1e-12),
  cmp("原稿：MBS 20経路の平均価格", m$paths$mean_price, bv("mbs.path.mean_price"), 1e-11),
  info("MBS：2000経路（パッケージの乱数）の平均価格 − 原稿の20経路", m$own_paths$mean_price, bv("mbs.path.mean_price"),
       sprintf("判定しない：経路の本数と乱数が別。2000経路の標準誤差は %.3f", m$own_paths$standard_error))
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "callable_diffs.csv"), row.names = FALSE)

golden <- list(
  engine = "the manuscript's R functions (chapter II-8, read from the qmd)",
  bullet_curve = ms$bullet_curve_price, bullet = ms$model_result$bullet_price, callable = ms$model_result$callable_price,
  issuer_call_value = ms$model_result$issuer_call_value,
  by_volatility = ms$tbl_volatility_sensitivity$callable_price, by_grid = ms$tbl_grid_convergence$callable_price,
  scenarios = as.data.frame(scen_ms |> select(weighted_average_life, price_fixed_discount, price_path_discount, total_principal)),
  path_price = ms$tbl_mbs_mc$price, path_wal = ms$tbl_mbs_mc$weighted_average_life, static_oas_bp = static_ms$oas_bp
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/callable_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), R.version.string, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
