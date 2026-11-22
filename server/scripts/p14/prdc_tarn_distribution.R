# 14.4: a target redemption (TARN) with a knock-out, by Monte Carlo of the three-factor model (FX and two Hull-White short rates):
# the probability of ending on each date, the expected life, the value against the target, and the convergence of the value in the
# number of paths up to 200,000. Synthetic inputs: five-year annual coupons, spot 150, FX volatility 11%, yen 1%, dollar 4%,
# leverage 80%, subtraction 78%, floor 0, cap 8%, notional 100, 12 steps a year.
#
#   Rscript server/scripts/p14/prdc_tarn_distribution.R

source(file.path("server", "scripts", "p16", "common.R"))
P16_OUT <- file.path("server", "data", "p14")
dir.create(P16_OUT, recursive = TRUE, showWarnings = FALSE)

today <- as.Date(p16_settlement)
dom <- create_flat_curve(today, 0.01, "actual_365_fixed", "continuous", index = "tonar")
foreign <- create_flat_curve(today, 0.04, "actual_365_fixed", "continuous", index = "sofr")
seed <- 7L
value <- function(paths, target = Inf, knock_out = Inf, make_whole = FALSE) {
  compute_prdc_three_factor_value(150, 0.11, dom, foreign, c(0.03, 0.01), c(0.05, 0.012), c(0.3, -0.2, 0.4), 1:5, rep(1, 5), 150, 0.8, 0.78, 0, 0.08, notional = 100,
                                  paths = as.integer(paths), steps_per_year = 12L, seed = seed, target = target, make_whole = make_whole, knock_out_level = knock_out)
}

# the distribution of the end of the note: target 15%, knock-out at 200, 200,000 paths
big <- value(200000L, 0.15, 200, TRUE)
endings <- list(times = big$endings$time, target_probability = big$endings$target_probability, knock_out_probability = big$endings$knock_out_probability,
                alive_at_maturity = 1 - sum(big$endings$target_probability + big$endings$knock_out_probability))
summary <- as.list(big$summary)
cat(sprintf("200000 paths: value %.4f (se %.4f), plain %.4f, expected life %.3f\n", summary$value, summary$standard_error, summary$plain_value, summary$expected_life))

# the convergence of the value
sizes <- c(2000L, 5000L, 20000L, 50000L, 200000L)
convergence <- lapply(sizes, function(n) {
  v <- value(n, 0.15, 200, TRUE)$summary
  list(paths = n, value = v$value, standard_error = v$standard_error, plain_value = v$plain_value, expected_life = v$expected_life)
})

# the value and the expected life against the target (the cap 8% a year, so at least 2 years for 15%)
targets <- c(0.05, 0.10, 0.15, 0.25, 0.40)
by_target <- lapply(targets, function(tg) {
  v <- value(20000L, tg, 200, TRUE)$summary
  list(target_pct = 100 * tg, value = v$value, standard_error = v$standard_error, plain_value = v$plain_value, expected_life = v$expected_life)
})
no_target <- value(20000L)$summary

p16_write("prdc_tarn_distribution.json", list(
  meta = p16_meta("server/scripts/p14/prdc_tarn_distribution.R", seed, "the same seed for every size; the times of the paths are of this machine"),
  inputs = list(years = 5, spot = 150, fx_vol_pct = 11, domestic_pct = 1, foreign_pct = 4, fx_base = 150, leverage_pct = 80, subtraction_pct = 78, floor_pct = 0, cap_pct = 8,
                notional = 100, steps_per_year = 12, target_pct = 15, knock_out_level = 200, make_whole = TRUE),
  endings = endings, summary_200000 = summary, convergence = convergence, by_target = by_target,
  no_target = list(value = no_target$value, standard_error = no_target$standard_error, analytic = no_target$analytic)
))
