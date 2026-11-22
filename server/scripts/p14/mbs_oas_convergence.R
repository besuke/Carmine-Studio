# 14.3: the option-adjusted spread of a pass-through over Hull-White paths, for 200 to 20,000 paths. The spread is a Monte Carlo
# estimate, so it moves with the seed; the spread of the estimates over seeds falls like one over the square root of the paths.
# Synthetic inputs: 100 of balance, mortgage 5%, pass-through 4.5%, 360 months, 100% PSA, sensitivity 20, refinancing cost 0.5%;
# Hull-White on a flat 2% (mean reversion 0.15, volatility 1.2%), refinancing rate = short rate + 3%, assumed price 105.
#
#   Rscript server/scripts/p14/mbs_oas_convergence.R

source(file.path("server", "scripts", "p16", "common.R"))
P16_OUT <- file.path("server", "data", "p14")
dir.create(P16_OUT, recursive = TRUE, showWarnings = FALSE)

pool <- create_mbs_pass_through(100, 0.05, 0.045, 360L, 1, 20, 0.005)
price <- 105
paths <- c(200L, 500L, 1000L, 2000L, 5000L, 20000L)
seeds <- c(20L, 10L, 10L, 5L, 3L, 2L)   # the estimates per size: fewer for the large ones, which take longer

rows <- lapply(seq_along(paths), function(i) {
  n <- paths[i]
  oas <- vapply(seq_len(seeds[i]), function(s) {
    r <- generate_hull_white_monthly_rates(n, 360L, 0.02, 0.15, 0.012, seed = 1000L * s + 48L)
    1e4 * compute_mbs_oas(pool, price, r, pmax(r + 0.03, 0))
  }, 0)
  elapsed <- p16_time(\() {
    r <- generate_hull_white_monthly_rates(n, 360L, 0.02, 0.15, 0.012, seed = 48L)
    compute_mbs_oas(pool, price, r, pmax(r + 0.03, 0))
  }, reps = 1L)
  cat(sprintf("paths %5d: seeds %2d, OAS %.2f bp, sd %.2f bp, %.2f s\n", n, seeds[i], mean(oas), sd(oas), elapsed))
  list(paths = n, seeds = seeds[i], oas_bp = oas, mean_oas_bp = mean(oas), sd_oas_bp = sd(oas), seconds = elapsed)
})

# the price of the same pool on a flat row of rates (one path), for the static spread
flat <- matrix(0.02, 1L, 360L)
static_oas <- 1e4 * compute_mbs_oas(pool, price, flat, pmax(flat + 0.03, 0))

p16_write("mbs_oas_convergence.json", list(
  meta = p16_meta("server/scripts/p14/mbs_oas_convergence.R", 48L, "seeds 1000 s + 48 for the s-th estimate; the times are of this machine on the day"),
  inputs = list(balance = 100, mortgage_rate_pct = 5, pass_through_rate_pct = 4.5, months = 360, psa_pct = 100, incentive = 20, refi_cost_pct = 0.5,
                flat_rate_pct = 2, mean_reversion = 0.15, volatility_pct = 1.2, spread_pct = 3, assumed_price = price),
  static_oas_bp = static_oas, rows = rows
))
