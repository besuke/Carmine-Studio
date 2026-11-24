# Reconcile chapter 15's three-factor PRDC (no call): rmql's automatic differentiation (first derivatives and, with
# second_order = "full", the ten second derivatives among the spot, the FX volatility and the two curves' shifts) against finite
# differences of the value, over several bump widths, to see where the finite differences are stable. The tolerances of tests/prdcThreeFactor.api.test.ts come from here.
#
#   npm run reconcile:prdc-three-factor
#
# Writes server/tests/golden/prdc_three_factor_golden.json (the page's numbers at the default inputs) and
# server/tests/reconciliation/prdc_three_factor/results/.

suppressPackageStartupMessages({
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/prdc_three_factor/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/prdc_risk_model.R"))
source(file.path(lab, "server/R/prdc_three_factor_model.R"))

m <- P3_MODEL; S <- m$spot; sig <- m$fx_volatility
rho <- unlist(P3_DEFAULTS$correlation, use.names = FALSE)
g <- p3_greeks(rho)
first <- setNames(p3_value(S, sig, rho)$sensitivity$d_npv, p3_value(S, sig, rho)$sensitivity$parameter)
npv <- function(spot = S, vol = sig, r = rho, ds = 0, fs = 0) p3_npv(spot, vol, r, domestic_shift = ds, foreign_shift = fs)

# ---- 1. the correlations: a central difference of the value against the first derivative ---------------------------
names_rho <- c("rho_domestic_foreign", "rho_domestic_fx", "rho_foreign_fx")
corr_widths <- c(1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6)
corr <- map_dfr(1:3, \(i) map_dfr(corr_widths, \(h) {
  up <- rho; dn <- rho; up[i] <- up[i] + h; dn[i] <- dn[i] - h
  fd <- (npv(r = up) - npv(r = dn)) / (2 * h)
  tibble(family = "correlation", quantity = names_rho[i], spot_width = NA_real_, width = h, finite_difference = fd, automatic_differentiation = first[[names_rho[i]]])
}))

# ---- 2. the cross-gammas: four-point differences of the value against the second-order automatic differentiation -----
four <- function(f, ha, hb) (f(ha, hb) - f(ha, -hb) - f(-ha, hb) + f(-ha, -hb)) / (4 * ha * hb)
spot_widths <- c(1.5, 0.15, 0.015, 0.0015)
rate_widths <- c(1e-2, 1e-3, 1e-4, 1e-5, 1e-6) # of the parallel shift of the zero rates, in decimals (1e-4 is 1 bp)
vol_widths <- c(1e-2, 1e-3, 5e-4, 1e-4, 1e-5, 1e-6)
cross <- bind_rows(
  map_dfr(c("domestic", "foreign"), \(side) map_dfr(spot_widths, \(hs) map_dfr(rate_widths, \(h) tibble(
    family = "cross_gamma", quantity = paste0("spot_", side, "_curve_shift"), spot_width = hs, width = h,
    finite_difference = four(\(a, b) if (side == "domestic") npv(S + a, ds = b) else npv(S + a, fs = b), hs, h),
    automatic_differentiation = p3_h(g$d2, "spot", paste0(side, "_curve_shift")))))),
  map_dfr(spot_widths, \(hs) map_dfr(vol_widths, \(h) tibble(
    family = "vanna", quantity = "spot_fx_volatility", spot_width = hs, width = h,
    finite_difference = four(\(a, b) npv(S + a, sig + b), hs, h), automatic_differentiation = p3_h(g$d2, "spot", "fx_volatility"))))
)
# ---- 2b. the other seven second derivatives: three-point differences on the diagonal, four-point differences for the crosses --------------
v0 <- npv()
value_at <- function(x) npv(S + x[1], sig + x[2], ds = x[3], fs = x[4]) # x = (spot in yen, volatility, domestic shift, foreign shift)
e <- function(i, h) { x <- c(0, 0, 0, 0); x[i] <- h; x }
three <- function(i, h) (value_at(e(i, h)) - 2 * v0 + value_at(e(i, -h))) / h^2
mixed <- function(i, hi, j, hj) (value_at(e(i, hi) + e(j, hj)) - value_at(e(i, hi) - e(j, hj)) - value_at(-e(i, hi) + e(j, hj)) + value_at(-e(i, hi) - e(j, hj))) / (4 * hi * hj)
gamma_widths <- c(5, 1.5, 0.5, 0.15, 0.05, 0.015, 0.005, 0.0015) # of the spot, in yen
volga_widths <- c(1e-2, 3e-3, 1e-3, 3e-4, 1e-4)
rate2_widths <- c(1e-3, 3e-4, 1e-4, 3e-5, 1e-5, 1e-6)
ad2 <- function(a, b) p3_h(g$d2, a, b)
second_rows <- bind_rows(
  map_dfr(gamma_widths, \(h) tibble(family = "gamma", quantity = "spot_spot", spot_width = h, width = NA_real_, finite_difference = three(1, h), automatic_differentiation = ad2("spot", "spot"))),
  map_dfr(volga_widths, \(h) tibble(family = "volga", quantity = "fx_volatility_fx_volatility", spot_width = NA_real_, width = h, finite_difference = three(2, h), automatic_differentiation = ad2("fx_volatility", "fx_volatility"))),
  map_dfr(rate2_widths, \(h) tibble(family = "rate_second", quantity = "domestic_domestic", spot_width = NA_real_, width = h, finite_difference = three(3, h), automatic_differentiation = ad2("domestic_curve_shift", "domestic_curve_shift"))),
  map_dfr(rate2_widths, \(h) tibble(family = "rate_second", quantity = "foreign_foreign", spot_width = NA_real_, width = h, finite_difference = three(4, h), automatic_differentiation = ad2("foreign_curve_shift", "foreign_curve_shift"))),
  map_dfr(rate2_widths, \(h) tibble(family = "rate_cross", quantity = "domestic_foreign", spot_width = NA_real_, width = h, finite_difference = mixed(3, h, 4, h), automatic_differentiation = ad2("domestic_curve_shift", "foreign_curve_shift"))),
  map_dfr(c("domestic", "foreign"), \(side) map_dfr(rate2_widths, \(hr) map_dfr(volga_widths, \(hv) tibble(
    family = "rate_vol", quantity = paste0(side, "_fx_volatility"), spot_width = hr, width = hv,
    finite_difference = mixed(if (side == "domestic") 3 else 4, hr, 2, hv), automatic_differentiation = ad2(paste0(side, "_curve_shift"), "fx_volatility")))))
)
# the first column "spot_width" holds the first width of a pair (the rate width for the rate and volatility crosses), as for the crosses with the spot

study <- bind_rows(corr, cross, second_rows) |> mutate(relative_error = abs(finite_difference - automatic_differentiation) / abs(automatic_differentiation))
write.csv(study, file.path(out_dir, "bump_study.csv"), row.names = FALSE)

# where the finite differences are stable: the widths with a relative error below 1e-4 and 1e-5, and the best one
summary <- study |> group_by(family, quantity) |>
  summarise(best = min(relative_error), best_spot_width = spot_width[which.min(relative_error)][1], best_width = width[which.min(relative_error)][1],
            n = n(), below_1e4 = sum(relative_error < 1e-4), below_1e5 = sum(relative_error < 1e-5), .groups = "drop")
write.csv(summary, file.path(out_dir, "bump_summary.csv"), row.names = FALSE)
print(as.data.frame(summary), digits = 3)
cat("\nThe widths of the page (P3_BUMP): correlation", P3_BUMP$correlation, ", spot", P3_BUMP$spot, ", volatility", P3_BUMP$volatility, ", rate", P3_BUMP$rate, "\n")
same <- function(x, y) !is.na(x) & abs(x - y) < 1e-12 * pmax(1, abs(y))
at_page <- study |> filter((family == "correlation" & same(width, P3_BUMP$correlation)) |
                           (family == "cross_gamma" & same(spot_width, P3_BUMP$spot) & same(width, P3_BUMP$rate)) |
                           (family == "vanna" & same(spot_width, P3_BUMP$spot) & same(width, P3_BUMP$volatility)) |
                           (family == "gamma" & same(spot_width, P3_BUMP$spot)) |
                           (family == "volga" & same(width, P3_BUMP$volatility)) |
                           (family == "rate_second" & same(width, P3_BUMP$rate2)) |
                           (family == "rate_cross" & same(width, P3_BUMP$rate)) |
                           (family == "rate_vol" & same(spot_width, P3_BUMP$rate) & same(width, P3_BUMP$volatility)))
print(as.data.frame(at_page[, c("family", "quantity", "finite_difference", "automatic_differentiation", "relative_error")]), digits = 6)

# ---- 3. the page's numbers at the default inputs (the regression values of the API tests) ---------------------------
main <- prdc_three_factor_compute(list())
scan <- prdc_three_factor_scan(list())
scenario <- prdc_three_factor_scenario(list())
curve <- prdc_three_factor_scenario_curve(list())
pick <- curve$points[[which(P3_SPOT_GRID == 5)]]
golden <- list(
  run_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"), rmql = as.character(packageVersion("rmql")),
  npv = main$npv, greeks = main$greeks,
  correlation = main$correlation[, c("pair", "automatic_differentiation", "finite_difference")],
  second_order = main$second_order[, c("item", "automatic_differentiation", "finite_difference")], # the ten rows
  scan_slopes = list(correlation = map_dbl(scan$correlation, "slope"), cross_gamma = c(scan$cross_gamma$domestic$slope_per_bp, scan$cross_gamma$foreign$slope_per_bp),
                     vanna = c(scan$vanna$delta_by_vol$slope_per_point, scan$vanna$vega_by_spot$slope_per_yen)),
  scenario = list(shock = scenario$inputs$shock, pnl = scenario$pnl, contribution = scenario$contribution$value),
  curve_at_5 = list(full = pick$full, first_order = pick$first_order, first_plus_cross = pick$first_plus_cross, cross = unlist(pick$cross)),
  bubble_scale = curve$bubble_scale)
write_json(golden, file.path(lab, "server/tests/golden/prdc_three_factor_golden.json"), auto_unbox = TRUE, digits = NA, pretty = TRUE)
writeLines(c(paste("run_at:", golden$run_at), paste("rmql:", golden$rmql), capture.output(sessionInfo())), file.path(out_dir, "session_info.txt"))
cat("\nwrote", file.path(lab, "server/tests/golden/prdc_three_factor_golden.json"), "\n")
