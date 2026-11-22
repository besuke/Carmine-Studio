# Reconcile the Part III page (Coral Book III-1 to III-7 on the PRDC of III-7): the page's own model
# (server/R/prdc_risk_model.R, rmql) against an independent closed form in R, against bump and revalue,
# against itself on several threads and in jobs, and against the manuscript's own torch code (read from the qmd).
#
#   npm run reconcile:prdc-risk
#
# Writes server/tests/golden/prdc_risk_golden.json and server/tests/reconciliation/prdc_risk/results/.

suppressPackageStartupMessages({
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/prdc_risk/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/prdc_risk_model.R"))
api <- prdc_risk_compute(list())
n <- PR_NOTE

# ---- an independent closed form in R: each coupon a floor plus a call spread on the forward FX -------------------
ref_value <- function(spot, vol, jpy = n$jpy, foreign = n$foreign) {
  t <- PR_TIMES
  dfd <- exp(-cumsum(jpy)); dff <- exp(-cumsum(foreign))
  fwd <- spot * dff / dfd
  sd <- vol * sqrt(t)
  call <- function(k) { d1 <- (log(fwd / k) + sd^2 / 2) / sd; fwd * pnorm(d1) - k * pnorm(d1 - sd) }
  low <- n$reference_fx * (n$leverage - n$fixed_coupon + n$floor) / n$leverage
  high <- n$reference_fx * (n$leverage - n$fixed_coupon + n$cap) / n$leverage
  rate <- n$floor + n$leverage / n$reference_fx * (call(low) - call(high))
  n$notional * (sum(rate * dfd) + dfd[length(dfd)])
}
# per-year rates bumped by 1bp, central, for the manuscript's definition
per_year_bump <- function(side) vapply(seq_along(PR_TIMES), \(j) {
  e <- replace(rep(0, 5), j, 1e-4)
  if (side == "jpy") (ref_value(150, 0.12, jpy = n$jpy + e) - ref_value(150, 0.12, jpy = n$jpy - e)) / 2
  else (ref_value(150, 0.12, foreign = n$foreign + e) - ref_value(150, 0.12, foreign = n$foreign - e)) / 2
}, 0)

# ---- the manuscript's torch code (III-7.1–7.3), read from the qmd ----------------------------------------------
qmd <- "C:/AnalyticFin/Projects/Coral-Book/part3_enterprise_riemann/ch07_prdc_autodiff.qmd"
lines <- readLines(qmd, encoding = "UTF-8")
chunk_code <- function(label) {
  start <- grep(sprintf("^#\\| label: %s$", label), lines)
  stopifnot(length(start) == 1L)
  end <- start + which(lines[(start + 1):length(lines)] == "```")[1]
  code <- lines[(start + 1):(end - 1)]
  code[!grepl("^#\\|", code)]
}
ms <- new.env()
suppressPackageStartupMessages(library(torch))
for (label in c("prdc-market-input", "prdc-jpy-foreign-curves", "prdc-mc-common-random-numbers", "prdc-market-risk-tensors",
                "prdc-contract-tensors", "prdc-mc-pricing-function", "prdc-mc-present-value", "prdc-autodiff-risk-gradient")) {
  invisible(capture.output(eval(parse(text = chunk_code(label)), envir = ms)))
}
torch_npv <- as.numeric(ms$prdc_npv)
torch_delta <- as.numeric(ms$fx_delta_t)
torch_vega <- as.numeric(ms$fx_vega_t)
torch_jpy <- as.numeric(ms$jpy_rate_grad_t) * 1e-4
torch_foreign <- as.numeric(ms$foreign_rate_grad_t) * 1e-4

# ---- comparisons -----------------------------------------------------------------------------------------------
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
rel <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)) / pmax(1, abs(as.numeric(ref))))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = paste("相対誤差。", note))
}
info <- function(item, a, ref, note) tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA_real_, pass = NA, note = note)
t <- api$ad$table
job <- prdc_risk_job(list(scenarios = data.frame(id = 1:3, spot = c(135, 150, 165), volPct = c(10, 12, 14))))
mc_se <- api$mc$standard_error
rows <- bind_rows(
  cmp("現在価値：RFM の閉じた式 − R の独立な式（円）", api$ad$npv, ref_value(150, 0.12), 1e-6),
  rel("自動微分 − Bump & Revalue（FX デルタ・ベガ・カーブ節点 10）", t$automatic_differentiation, t$bump_and_revalue, 1e-5,
      "中心差分の打ち切り誤差（刻み：スポット 1e-4 × S、ボラ 1e-4、金利 1bp）"),
  rel("年ごとの円金利の感応度：自動微分 − 独立な式の中心差分（円／1bp）", api$ad$per_year$jpy_rate_per_bp, per_year_bump("jpy"), 1e-5),
  rel("年ごとの外貨金利の感応度：自動微分 − 独立な式の中心差分（円／1bp）", api$ad$per_year$foreign_rate_per_bp, per_year_bump("foreign"), 1e-5),
  cmp("MC：スレッド数（1・2・4・8）による価格の差", api$threads$table$difference_from_one_thread, 0, 0),
  cmp("ジョブで評価した値 − 1件ずつの閉じた式", job$results$npv, map2_dbl(job$results$spot, job$results$volPct / 100, \(s, v) pr_value(s, v)$summary$npv), 0),
  info("原稿の torch MC（20000本）− 閉じた式：現在価値（円）", torch_npv, api$ad$npv,
       sprintf("判定しない：乱数が別のモンテカルロ。差は RFM の MC（同じ本数）の標準誤差 %.0f 円の %.2f 倍", mc_se, (torch_npv - api$ad$npv) / mc_se)),
  info("原稿の torch MC − 閉じた式：FX デルタ（円／1円）", torch_delta, t$automatic_differentiation[1], "判定しない：モンテカルロの標本誤差"),
  info("原稿の torch MC − 閉じた式：FX ベガ（円／ボラ 1）", torch_vega, t$automatic_differentiation[2], "判定しない：モンテカルロの標本誤差"),
  info("原稿の torch MC − 閉じた式：年ごとの円金利（円／1bp）", torch_jpy, api$ad$per_year$jpy_rate_per_bp, "判定しない：モンテカルロの標本誤差"),
  info("原稿の torch MC − 閉じた式：年ごとの外貨金利（円／1bp）", torch_foreign, api$ad$per_year$foreign_rate_per_bp, "判定しない：モンテカルロの標本誤差")
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
cat(sprintf("\n原稿の torch：NPV %.0f、デルタ %.1f、ベガ %.0f\n", torch_npv, torch_delta, torch_vega))
utils::write.csv(rows, file.path(out_dir, "prdc_risk_diffs.csv"), row.names = FALSE)
write(toJSON(list(engine = "an independent closed form in R; the manuscript's torch code",
                  npv_closed = ref_value(150, 0.12), per_year_jpy = per_year_bump("jpy"), per_year_foreign = per_year_bump("foreign"),
                  torch = list(npv = torch_npv, fx_delta = torch_delta, fx_vega = torch_vega, jpy_per_bp = torch_jpy, foreign_per_bp = torch_foreign)),
             auto_unbox = TRUE, digits = I(17), pretty = TRUE), file.path(lab, "server/tests/golden/prdc_risk_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), R.version.string, paste("torch", as.character(packageVersion("torch"))),
             paste("rmql", as.character(packageVersion("rmql")))), file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
