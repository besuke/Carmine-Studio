# Reconcile chapter 11.5 (a network that learned the Black-Scholes call price). The network is an approximation, so what is reconciled
# is not its closeness to the closed form (that is the result, recorded in the saved training results) but the machinery:
#   - the teacher: rmql's closed form against the Black-Scholes formula written here (pnorm),
#   - the server's forward pass against a per-row forward written here from the saved weights,
#   - the server's backward pass (the derivative with respect to the input) against central differences of the forward pass,
#   - the delta of the network against a central difference of its price in the spot,
#   - the homogeneity in (S, K) that the network's input choice relies on,
#   - the error on fresh points inside the training range against the error recorded at training (same order of size).
# All inputs are synthetic.
#
#   npm run reconcile:bs-surrogate

suppressPackageStartupMessages(library(rmql))
lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/cnn_bs")
dir.create(file.path(out_dir, "results"), showWarnings = FALSE, recursive = TRUE)
script_dir <- file.path(lab, "server")
source(file.path(script_dir, "R", "lookback_model.R"))
source(file.path(script_dir, "R", "bs_surrogate_model.R"))
set.seed(20261123)
r <- bs_results()
lo <- BS_CACHE$lo; hi <- BS_CACHE$hi

checks <- list()
record <- function(what, n, worst, tolerance, note = "") {
  checks[[length(checks) + 1L]] <<- data.frame(check = what, cases = n, worst = worst, tolerance = tolerance, passed = is.finite(worst) && worst <= tolerance, note = note)
}
draw <- function(n, a, b) sapply(seq_along(a), function(j) runif(n, a[j], b[j]))

# ---- the teacher: rmql's closed form against pnorm ----------------------------------------------------------------------------
x <- draw(500L, lo, hi)
spot <- exp(x[, 1]); time <- x[, 2]; vol <- x[, 3]; rate <- x[, 4]; div <- x[, 5]
d1 <- (log(spot) + (rate - div + 0.5 * vol^2) * time) / (vol * sqrt(time)); d2 <- d1 - vol * sqrt(time)
bs_price <- spot * exp(-div * time) * pnorm(d1) - exp(-rate * time) * pnorm(d2)
bs_delta <- exp(-div * time) * pnorm(d1)
tc <- compute_european_option_value("call", spot, 1, rate, div, vol, time)
record("rmql's closed form against the Black-Scholes formula written here: the price (largest absolute difference; a relative difference is meaningless for the deep out-of-the-money prices of about 1e-13)", 500L, max(abs(tc$value - bs_price)), 1e-12)
record("rmql's closed form against the Black-Scholes formula written here: the delta (largest absolute difference)", 500L, max(abs(tc$delta - bs_delta)), 1e-10)

# ---- the server's forward pass against a per-row forward from the saved weights ----------------------------------------------
w <- r$weights
w1 <- as.matrix(w$w1); w2 <- as.matrix(w$w2); w3 <- as.numeric(w$w3); b1 <- as.numeric(w$b1); b2 <- as.numeric(w$b2); b3 <- as.numeric(w$b3)
mid <- (lo + hi) / 2; half <- (hi - lo) / 2
forward_row <- function(xr) {
  u <- (xr - mid) / half
  a1 <- vapply(seq_along(b1), \(j) tanh(sum(u * w1[, j]) + b1[j]), 0)
  a2 <- vapply(seq_along(b2), \(j) tanh(sum(a1 * w2[, j]) + b2[j]), 0)
  sum(a2 * w3) + b3
}
own <- apply(x[1:200, ], 1, forward_row)
api <- apply(x[1:200, ], 1, \(xr) bs_net(xr)$price)
record("the server's forward pass against a per-row forward written here (largest absolute difference)", 200L, max(abs(own - api)), 1e-12)

# ---- the backward pass against central differences of the forward pass ---------------------------------------------------------
eps <- 1e-6
grad_err <- vapply(1:100, function(i) {
  g <- bs_net(x[i, ])$gradient
  num <- vapply(1:5, function(j) { up <- x[i, ]; dn <- x[i, ]; h <- eps * half[j]; up[j] <- up[j] + h; dn[j] <- dn[j] - h; (forward_row(up) - forward_row(dn)) / (2 * h) }, 0)
  max(abs(g - num)) / max(abs(g))
}, 0)
record("the derivative with respect to the five inputs (backward pass) against central differences (largest difference / largest entry)", 100L, max(grad_err), 1e-6)

# ---- the delta, and the homogeneity in (S, K) ---------------------------------------------------------------------------------
delta_err <- vapply(1:50, function(i) {
  s <- spot[i] * 100; k <- 100; h <- 1e-4 * s
  p <- \(sv) bs_surrogate_compute(list(spot = sv, strike = k, ratePct = 100 * rate[i], dividendYieldPct = 100 * div[i], volatilityPct = 100 * vol[i], time = time[i]))
  a <- p(s)$network$delta
  (p(s + h)$network$price - p(s - h)$network$price) / (2 * h) - a
}, 0)
record("the delta of the network against a central difference of its price in the spot (largest absolute difference)", 50L, max(abs(delta_err)), 1e-6)
hom <- vapply(1:50, function(i) {
  base <- list(ratePct = 100 * rate[i], dividendYieldPct = 100 * div[i], volatilityPct = 100 * vol[i], time = time[i])
  a <- do.call(bs_surrogate_compute, list(c(base, list(spot = 100 * spot[i], strike = 100))))
  b <- do.call(bs_surrogate_compute, list(c(base, list(spot = 700 * spot[i], strike = 700))))
  abs(b$network$price - 7 * a$network$price) / (7 * a$network$price)
}, 0)
record("homogeneity: scaling S and K by 7 scales the network's price by 7 (largest relative difference)", 50L, max(hom), 1e-12)

# ---- fresh points inside the range against the recorded error -----------------------------------------------------------------
xf <- draw(2000L, lo, hi)
tf <- compute_european_option_value("call", exp(xf[, 1]), 1, xf[, 4], xf[, 5], xf[, 3], xf[, 2])
nn <- t(apply(xf, 1, \(xr) { g <- bs_net(xr); c(g$price, g$gradient[1] * exp(-xr[1])) }))
rmse_price <- sqrt(mean((nn[, 1] - tf$value)^2)); rmse_delta <- sqrt(mean((nn[, 2] - tf$delta)^2))
rec <- r$errors[r$errors$set == "in_range", ]
ratio <- c(rmse_price / rec$price_rmse, rmse_delta / rec$delta_rmse)
record("fresh points inside the range: the RMSE of the price and of the delta are within a factor 1.5 of those recorded at training", 2L, max(pmax(ratio, 1 / ratio)) - 1, 0.5,
       sprintf("price RMSE %.2e (recorded %.2e), delta RMSE %.2e (recorded %.2e)", rmse_price, rec$price_rmse, rmse_delta, rec$delta_rmse))

summary <- do.call(rbind, checks)
utils::write.csv(summary, file.path(out_dir, "results", "summary.csv"), row.names = FALSE)
writeLines(c(
  "# Reconciliation of chapter 11.5 (a network that learned the Black-Scholes call price)",
  "",
  sprintf("Run %s with rmql %s. Synthetic inputs. `npm run reconcile:bs-surrogate`.", format(Sys.time(), "%Y-%m-%d"), as.character(packageVersion("rmql"))),
  "",
  "The network is an approximation; its error against the closed form is the *result* (in `server/data/cnn/bs_surrogate_results.json` and on the page), not something to reconcile. What is checked here is the machinery that produces and compares the numbers.",
  "",
  "| Check | Cases | Largest difference | Tolerance | Result | Note |",
  "|---|---:|---:|---:|---|---|",
  sprintf("| %s | %d | %.3g | %.3g | %s | %s |", summary$check, summary$cases, summary$worst, summary$tolerance, ifelse(summary$passed, "pass", "FAIL"), summary$note)
), file.path(out_dir, "RECONCILIATION_BS_SURROGATE.md"), useBytes = TRUE)
print(summary[, c("cases", "worst", "tolerance", "passed")], row.names = FALSE)
if (!all(summary$passed)) stop("some checks of chapter 11.5 failed: ", paste(summary$check[!summary$passed], collapse = "; "))
cat("all", nrow(summary), "checks passed\n")
