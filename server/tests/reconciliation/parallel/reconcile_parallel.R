# Reconcile the parallel computing chapter (Coral Book III-1): the manuscript's sequential and parallel examples
# (purrr and furrr, read from the qmd) against the page's own model (server/R/parallel_model.R), and the batch of bonds
# on several threads against itself and against one bond at a time.
#
#   npm run reconcile:parallel
#
# Writes server/tests/golden/parallel_golden.json and server/tests/reconciliation/parallel/results/.

suppressPackageStartupMessages({
  library(rmql)
  library(dplyr)
  library(tidyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/parallel/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/parallel_model.R"))
api <- parallel_compute(list(batch = list(count = 2000, maxThreads = 8)))

# ---- the manuscript's code, read from the qmd ----------------------------------------------------------------------
qmd <- "C:/AnalyticFin/Projects/Coral-Book/part3_enterprise_riemann/ch01_computational_evolution_parallel.qmd"
lines <- readLines(qmd, encoding = "UTF-8")
chunk_code <- function(label) {
  start <- grep(sprintf("^#\\| label: %s$", label), lines)
  stopifnot(length(start) == 1L)
  end <- start + which(lines[(start + 1):length(lines)] == "```")[1]
  code <- lines[(start + 1):(end - 1)]
  code[!grepl("^#\\|", code)]
}
ms <- new.env()
ms$show_table_LFL <- function(...) invisible(NULL)
for (label in c("parallel-present-value-function", "parallel-scenario-data", "sequential-present-value", "multisession-worker-plan",
                "parallel-present-value", "sequential-parallel-comparison", "parallel-result-validation", "sequential-plan-restore")) {
  eval(parse(text = chunk_code(label)), envir = ms)
}

# ---- one bond at a time, for the batch -------------------------------------------------------------------------------
bonds <- par_bonds(2000)
rows_checked <- c(1L, 500L, 1000L, 1500L, 2000L)
one_by_one <- map_dfr(rows_checked, \(i) {
  b <- bonds[i, ]
  bond <- rmql::create_fixed_rate_bond(
    settlement_days = b$settlement_days, face_amount = b$face_amount, effective_date = b$effective_date, termination_date = b$termination_date,
    tenor = b$tenor, calendar = b$calendar, convention = b$convention, termination_convention = b$termination_convention, rule = b$rule,
    end_of_month = b$end_of_month, coupon_rate = b$coupon_rate, day_count = b$day_count, payment_convention = b$payment_convention,
    redemption = b$redemption, issue_date = b$issue_date)
  settlement <- rmql::compute_settlement_date(bond, b$evaluation_date)
  v <- rmql::compute_bond_values(bond, b$rate, b$yield_day_count, b$compounding, b$frequency, settlement)
  tibble(row = i, clean_price = v$clean_price, duration_modified = v$duration_modified)
})
batch_one <- rmql::compute_bond_values_batch(bonds, threads = 1L)

# ---- comparisons -----------------------------------------------------------------------------------------------
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, value, note) tibble(item = item, n = length(value), max_abs_diff = NA_real_, tolerance = NA_real_, pass = NA, note = note)
t <- api$batch$timing
rows <- bind_rows(
  cmp("6シナリオの現在価値：ページ − 原稿の逐次（purrr）", api$example$present_value, ms$tbl_sequential_result$present_value, 0),
  cmp("6シナリオの現在価値：ページ − 原稿の並列（furrr）", api$example$present_value, ms$tbl_parallel_result$present_value, 0),
  cmp("原稿：逐次 − 並列", ms$tbl_result_comparison$difference, 0, 0),
  cmp("債券2000件：スレッド数を変えた結果の差（1・2・4・8）", t$max_abs_diff_from_one_thread, 0, 0),
  cmp("債券2000件：エラーの件数", t$errors, 0, 0),
  cmp("債券5件：一括（1スレッド）− 1件ずつ、単価", batch_one$clean_price[rows_checked], one_by_one$clean_price, 1e-12,
      "一括はワーカースレッドで、1件ずつは R のメインスレッドで計算する。最下位ビットが違ってよい（ヘルプの記述）"),
  cmp("債券5件：一括（1スレッド）− 1件ずつ、修正デュレーション", batch_one$duration_modified[rows_checked], one_by_one$duration_modified, 1e-12),
  info("計算時間（秒、1・2・4・8スレッド）", t$seconds, paste("判定しない：環境で変わる。", paste(sprintf("%d スレッド %.2f 秒", t$threads, t$seconds), collapse = "、")))
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "parallel_diffs.csv"), row.names = FALSE)
write(toJSON(list(engine = "the manuscript's purrr and furrr examples", present_value = ms$tbl_sequential_result$present_value,
                  one_by_one = one_by_one), auto_unbox = TRUE, digits = I(17), pretty = TRUE),
      file.path(lab, "server/tests/golden/parallel_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), R.version.string, paste("logical processors", PAR_CORES),
             paste("rmql", as.character(packageVersion("rmql")))), file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
