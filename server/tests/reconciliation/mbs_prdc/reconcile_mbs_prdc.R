# Reconcile chapter 14 (MBS and the PRDC target redemption) against independent calculations. The API functions
# (server/R/mbs_prdc_model.R) are called as the server calls them. All inputs are synthetic.
#   MBS:  the balance, the prepayment speed and the cash flows by a recursion written here from the rule, the price by discounting
#         written here, the closed form of the balance without prepayment, and the weighted average life.
#   PRDC: the closed form of the note without a target (the Monte Carlo against it, in standard errors), and the identities of
#         the target and the knock-out (a target that cannot be reached and a knock-out that cannot be hit are no state at all).
# The state's own logic of the target and the knock-out (the coupon of the date that reaches the target, the observation of the
# knock-out) is NOT checked against an independent simulation here; only these identities and the probabilities' consistency.
#
#   npm run reconcile:mbs-prdc

suppressPackageStartupMessages(library(rmql))
lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/mbs_prdc")
res_dir <- file.path(out_dir, "results")
dir.create(res_dir, showWarnings = FALSE, recursive = TRUE)
script_dir <- file.path(lab, "server")
source(file.path(script_dir, "R", "lookback_model.R"))
source(file.path(script_dir, "R", "mbs_prdc_model.R"))

checks <- list()
record <- function(group, what, n, worst, tolerance, note = "") {
  checks[[length(checks) + 1L]] <<- data.frame(group = group, check = what, cases = n, worst = worst, tolerance = tolerance, passed = is.finite(worst) && worst <= tolerance, note = note)
}

# ---- MBS: the recursion of the rule, written from the rule ----------------------------------------------------------------
recursion <- function(balance, mortgage, pass_through, months, psa, beta, cost, cap, refinance) {
  i <- mortgage / 12
  payment <- balance * i / (1 - (1 + i)^(-months))
  rows <- vector("list", months)
  for (m in seq_len(months)) {
    interest_m <- balance * i
    scheduled <- min(payment - interest_m, balance)
    cpr <- min(cap, psa * min(0.002 * m, 0.06) * exp(beta * (mortgage - refinance[m] - cost)))
    smm <- 1 - (1 - cpr)^(1 / 12)
    prepaid <- smm * (balance - scheduled)
    investor_interest <- balance * pass_through / 12
    rows[[m]] <- c(begin = balance, cpr = cpr, interest = investor_interest, scheduled = scheduled, prepaid = prepaid, end = balance - scheduled - prepaid,
                   cashflow = investor_interest + scheduled + prepaid)
    balance <- balance - scheduled - prepaid
  }
  as.data.frame(do.call(rbind, rows))
}
discounted <- function(cashflow, short, oas = 0) sum(cashflow * exp(-cumsum((short + oas) / 12)))

set.seed(20261123)
cases <- data.frame(mortgage = c(0.05, 0.06, 0.04, 0.055), pass = c(0.045, 0.055, 0.035, 0.05), months = c(360L, 240L, 180L, 120L), psa = c(1, 1.5, 0.5, 2),
                    beta = c(20, 10, 30, 20), cost = c(0.005, 0, 0.01, 0.005), start = c(0.04, 0.05, 0.03, 0.045), slope = c(0.005, 0.01, 0.003, 0))
mbs <- do.call(rbind, lapply(seq_len(nrow(cases)), function(k) {
  c <- cases[k, ]
  api <- mbs_state_compute(list(pool = list(balance = 100, mortgageRatePct = 100 * c$mortgage, passThroughRatePct = 100 * c$pass, months = c$months, psaPct = 100 * c$psa, incentive = c$beta,
                                           refiCostPct = 100 * c$cost), refinanceStartPct = 100 * c$start, slopePct = 100 * c$slope, mc = list(paths = 20)))
  do.call(rbind, lapply(names(api$scenarios), function(nm) {
    s <- api$scenarios[[nm]]
    own <- recursion(100, c$mortgage, c$pass, c$months, c$psa, c$beta, c$cost, 0.6, s$refinance_rate)
    short <- pmax(s$refinance_rate - 0.03, -0.02)
    price <- discounted(own$cashflow, short)
    principal <- own$scheduled + own$prepaid
    wal <- sum(seq_len(c$months) / 12 * principal) / sum(principal)
    data.frame(case = k, scenario = nm, balance_diff = max(abs(own$begin - s$balance)), cpr_diff = max(abs(own$cpr - s$cpr)), cashflow_diff = max(abs(own$cashflow - s$cashflow)),
               end_balance_diff = max(abs(own$end - s$end_balance)), price_api = s$price, price_own = price, price_diff = abs(s$price - price), wal_api = s$weighted_average_life, wal_own = wal, wal_diff = abs(s$weighted_average_life - wal))
  }))
}))
utils::write.csv(mbs, file.path(res_dir, "mbs_recursion.csv"), row.names = FALSE)
record("mbs", "the balance and the cash flows of the API against the recursion of the rule (largest difference)", nrow(mbs), max(mbs$balance_diff, mbs$end_balance_diff, mbs$cashflow_diff), 1e-9)
record("mbs", "the prepayment speed CPR against the rule", nrow(mbs), max(mbs$cpr_diff), 1e-12)
record("mbs", "the price of a path against discounting the cash flows exp(-sum r/12)", nrow(mbs), max(mbs$price_diff), 1e-9)
record("mbs", "the weighted average life against sum (m / 12) principal / sum principal", nrow(mbs), max(mbs$wal_diff), 1e-9)

# no prepayment: the balance is the level-payment annuity's, in closed form
zero <- mbs_state_compute(list(pool = list(months = 360, psaPct = 0), mc = list(paths = 6)))
i <- 0.05 / 12; N <- 360
closed <- 100 * ((1 + i)^N - (1 + i)^(0:(N - 1))) / ((1 + i)^N - 1)
record("mbs", "no prepayment (PSA 0): the balance against the closed form of the annuity", 1L, max(abs(zero$scenarios$flat$balance - closed)), 1e-9)
record("mbs", "no prepayment (PSA 0): the prepaid principal is zero", 1L, max(abs(zero$scenarios$flat$prepaid)), 0)

# the Monte Carlo price: the mean of the paths, discounted here with the OAS found; the OAS reprices
api <- mbs_state_compute(list(mc = list(paths = 50, seed = 11)))
oas <- api$monte_carlo$oas
pool <- create_mbs_pass_through(100, 0.05, 0.045, 360L, 1, 20, 0.005)
rates <- generate_hull_white_monthly_rates(50L, 360L, 0.02, 0.15, 0.012, seed = 11)
refi <- pmax(rates + 0.03, 0)
repriced <- mean(vapply(seq_len(50), \(p) discounted(compute_mbs_cashflows(pool, refi[p, ])$cashflow, rates[p, ], oas), 0))
record("mbs", "the OAS reprices the assumed price when each path is discounted here (the mean over 50 Hull-White paths)", 1L, abs(repriced - 105), 1e-6)
record("mbs", "the mean price of the API against the mean over the paths discounted here", 1L, abs(api$monte_carlo$price - mean(vapply(seq_len(50), \(p) discounted(compute_mbs_cashflows(pool, refi[p, ])$cashflow, rates[p, ]), 0))), 1e-9)

# ---- PRDC: the closed form and the identities of the state ------------------------------------------------------------------
plain <- prdc_tarn_compute(list(mc = list(paths = 20000, stepsPerYear = 3, seed = 3)))
z <- abs(plain$summary$value - plain$summary$analytic) / plain$summary$standard_error
record("prdc", "no target and no knock-out: the Monte Carlo value against the closed form, in standard errors (20,000 paths, 3 steps a year)", 1L, z, 4)
unreachable <- prdc_tarn_compute(list(tarn = list(targetPct = 1000), mc = list(paths = 2000, seed = 3)))
record("prdc", "a target that cannot be reached = no target (the same paths)", 1L, abs(unreachable$summary$value - unreachable$summary$plain_value), 1e-9)
no_hit <- prdc_tarn_compute(list(tarn = list(knockOutLevel = 1e6), mc = list(paths = 2000, seed = 3)))
record("prdc", "a knock-out level that cannot be hit = no knock-out (the same paths); its probability is zero", 1L, max(abs(no_hit$summary$value - no_hit$summary$plain_value), abs(no_hit$endings$knock_out_probability)), 1e-9)
tarn <- prdc_tarn_compute(list(tarn = list(targetPct = 15, makeWhole = TRUE, knockOutLevel = 200), mc = list(paths = 5000, seed = 3)))
e <- tarn$endings
ended <- e$target_probability + e$knock_out_probability
record("prdc", "the probabilities of the end are in [0, 1], and the survival is non-increasing and ends at 1 - their sum", 1L,
       max(max(0, -min(e$target_probability, e$knock_out_probability)), max(0, max(ended) - 1), max(0, max(diff(e$alive))), abs(tail(e$alive, 1) - (1 - sum(ended)))), 1e-12)
record("prdc", "the expected life is between 1 year and the maturity", 1L, max(0, 1 - tarn$summary$expected_life, tarn$summary$expected_life - 5), 0)
more <- prdc_tarn_compute(list(tarn = list(targetPct = 40, knockOutLevel = 200), mc = list(paths = 2000, seed = 3)))$summary$expected_life
less <- prdc_tarn_compute(list(tarn = list(targetPct = 5, knockOutLevel = 200), mc = list(paths = 2000, seed = 3)))$summary$expected_life
record("prdc", "a lower target ends earlier: the expected life of target 5% is shorter than that of 40%", 1L, max(0, less - more), 0)

summary <- do.call(rbind, checks)
utils::write.csv(summary, file.path(res_dir, "summary.csv"), row.names = FALSE)
writeLines(c(
  "# Reconciliation of chapter 14 (MBS and the PRDC target redemption)",
  "",
  sprintf("Run %s with rmql %s. Synthetic inputs. `npm run reconcile:mbs-prdc`; the MBS table is in `results/mbs_recursion.csv`.", format(Sys.time(), "%Y-%m-%d"), as.character(packageVersion("rmql"))),
  "",
  "| Group | Check | Cases | Largest difference | Tolerance | Result | Note |",
  "|---|---|---:|---:|---:|---|---|",
  sprintf("| %s | %s | %d | %.3g | %.3g | %s | %s |", summary$group, summary$check, summary$cases, summary$worst, summary$tolerance, ifelse(summary$passed, "pass", "FAIL"), summary$note),
  "",
  "**Not checked against an independent simulation**: the logic of the target (the coupon of the date that reaches it, the make-whole) and of the knock-out (its observation dates). The checks above are identities (a state that cannot occur is no state) and the consistency of the probabilities, so a mistake in that logic that keeps those would not be seen here."
), file.path(out_dir, "RECONCILIATION_MBS_PRDC.md"), useBytes = TRUE)
print(summary[, c("group", "cases", "worst", "tolerance", "passed")], row.names = FALSE)
if (!all(summary$passed)) stop("some checks of chapter 14 failed: ", paste(summary$check[!summary$passed], collapse = "; "))
cat("all", nrow(summary), "checks passed\n")
