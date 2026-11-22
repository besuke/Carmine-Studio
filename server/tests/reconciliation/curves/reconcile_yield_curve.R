# Reconcile the curves of Coral Book II-2.2, II-2.3.1, II-2.5.2 and II-2.5.3 (yield-curve chapter):
# GaussQuant / QuantLib 1.42 (the manuscript's code) against rmql (Carmine Studio's API path).
#
#   node ui/scripts/run-r.mjs server/tests/reconciliation/curves/reconcile_yield_curve.R
#
# Writes server/tests/golden/yield_curve_golden.json (GaussQuant's values, the reference of the API test) and
# server/tests/reconciliation/curves/results/yield_curve_diffs.csv. Nothing in GaussQuant, Coral Book or rmql is modified.
#
# Inputs as in the manuscript: evaluation date 2022-08-19, the zero-rate nodes of II-2.2.1 (illustrative values),
# Actual/365 Fixed. II-2.5.2 shifts the deposit + IBOR-swap curve of II-2.4.2 in the manuscript; rmql
# has no IBOR swap curve, so here the same +50bp shift (simple, annual: GaussQuant's default) is applied to the
# zero curve of II-2.2, on both sides.

suppressPackageStartupMessages({
  library(GaussQuant)
  library(QuantLib)
  library(rmql)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/curves/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

evaluation_date <- "2022-08-19"
nodes <- data.frame(
  tenor = c("0D", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y"),
  date = as.Date(c("2022-08-19", "2022-09-19", "2022-11-21", "2023-02-20", "2023-08-21", "2024-08-19", "2025-08-19", "2027-08-19", "2032-08-19")),
  zero_rate = c(0.0005, 0.0006, 0.0008, 0.0011, 0.0018, 0.0032, 0.0048, 0.0075, 0.0115)
)
tenors <- c("1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y")
shift <- 50 / 10000

# ---- GaussQuant (the manuscript's code) ---------------------------------------------------------------
GaussQuant::set_eval_date_GQL(evaluation_date)
zc <- GaussQuant::build_zero_curve_GQL(as.character(nodes$date), nodes$zero_rate, "Actual365Fixed")
dcv <- GaussQuant::build_discount_curve_GQL(nodes[, c("date", "zero_rate")], "Actual365Fixed")
zc_tenors <- GaussQuant::curve_tbl_GQH(zc, tenors)
grid <- GaussQuant::curve_grid_tbl_GQL(zc, n = 240L, extrapolate = TRUE)
max_time <- min(as.numeric(zc$maxTime()), as.numeric(dcv$maxTime()))
cmp_time <- seq(0, max_time, length.out = 300)
cmp_dates <- as.Date(evaluation_date) + round(cmp_time * 365)
spreaded <- GaussQuant::make_zero_spreaded_curve_GQL(GaussQuant::yield_curve_handle_GQL(zc), shift, QuantLib::Actual365Fixed())$curve
spread_tenors <- GaussQuant::curve_tbl_GQH(spreaded, tenors)
ql_df <- function(curve, dates) vapply(as.character(dates), function(d) GaussQuant::curve_discount_safe_GQL(curve, GaussQuant::date_GQL(d)), 0)

ref <- list(
  evaluation_date = evaluation_date, nodes = transform(nodes, date = format(date)), shift = shift,
  tenor_table = transform(as.data.frame(zc_tenors), date = format(date)),
  grid = data.frame(date = format(grid$curve_date), time = grid$time, discount = grid$discount_factor),
  comparison = data.frame(time = cmp_time, date = format(cmp_dates), zero_curve_discount = ql_df(zc, cmp_dates),
                          discount_curve_discount = ql_df(dcv, cmp_dates), row.names = NULL),
  shifted_tenor_table = transform(as.data.frame(spread_tenors), date = format(date)),
  node_recovery = data.frame(tenor = nodes$tenor, date = format(nodes$date), zero_curve_discount = ql_df(zc, nodes$date),
                             discount_curve_discount = ql_df(dcv, nodes$date), row.names = NULL),
  engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib", as.character(packageVersion("QuantLib")))
)

# ---- rmql on the same dates -------------------------------------------------------------------
rz <- rmql::with_extrapolation(rmql::create_zero_curve(nodes$date, nodes$zero_rate, "actual_365_fixed", "continuous"))
rd <- rmql::with_extrapolation(rmql::create_discount_curve(
  nodes$date, c(1, exp(-nodes$zero_rate[-1] * as.numeric(nodes$date[-1] - nodes$date[1]) / 365)), "actual_365_fixed", "log_linear"))
rs <- rmql::create_zero_spreaded_curve(rz, shift, "simple", 1L)
rdf <- function(curve, dates) rmql::compute_discount(curve, as.Date(dates))

diffs <- rbind(
  data.frame(item = "ZeroCurve 割引係数（年限表）", diff = rdf(rz, ref$tenor_table$date) - ref$tenor_table$discount),
  data.frame(item = "ZeroCurve 割引係数（グリッド240点）", diff = rdf(rz, ref$grid$date) - ref$grid$discount),
  data.frame(item = "ZeroCurve 割引係数（比較300点）", diff = rdf(rz, ref$comparison$date) - ref$comparison$zero_curve_discount),
  data.frame(item = "DiscountCurve 割引係数（比較300点）", diff = rdf(rd, ref$comparison$date) - ref$comparison$discount_curve_discount),
  data.frame(item = "+50bp シフト後の割引係数（年限表）", diff = rdf(rs, ref$shifted_tenor_table$date) - ref$shifted_tenor_table$discount),
  data.frame(item = "ノードの割引係数（ZeroCurve）", diff = rdf(rz, ref$node_recovery$date) - ref$node_recovery$zero_curve_discount),
  data.frame(item = "ノードの割引係数（DiscountCurve）", diff = rdf(rd, ref$node_recovery$date) - ref$node_recovery$discount_curve_discount)
)
summary <- do.call(rbind, lapply(split(diffs, factor(diffs$item, levels = unique(diffs$item))), function(x)
  data.frame(item = x$item[1], n = nrow(x), max_abs_diff = max(abs(x$diff)), tolerance = 1e-12, pass = max(abs(x$diff)) <= 1e-12)))
rownames(summary) <- NULL
print(summary, digits = 3)
utils::write.csv(summary, file.path(out_dir, "yield_curve_diffs.csv"), row.names = FALSE)
write(toJSON(ref, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/yield_curve_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), ref$engine,
             paste("rmql", as.character(packageVersion("rmql")))), file.path(out_dir, "session_info.txt"))
stopifnot(all(summary$pass))
