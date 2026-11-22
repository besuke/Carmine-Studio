# A fully connected network (MLP) that learns the Black-Scholes call price (chapter 11.5). The answer is known, so the network's error
# can be read against the true value, inside and outside the range it was trained on, and so can its derivative (the backward pass of
# 11.3, taken with respect to the input) against the true delta. Pure R: the forward and backward passes are the formulas of 11.2 and
# 11.3 for a dense layer, checked against numerical gradients before anything is trained. No deep-learning framework.
#
#   Rscript server/scripts/cnn/train_bs_surrogate.R
#
# Writes server/data/cnn/bs_surrogate_results.json (the weights, the learning curve, the errors in and out of the range, the curves).
#
# Design:
#   input   x = (ln(S/K), T, sigma, r, q). The call price is homogeneous of degree 1 in (S, K), so C = K c(ln(S/K), ...) and only
#           the five numbers matter. The inputs are scaled to [-1, 1] by the training range.
#   output  c = C / K, from rmql::compute_european_option_value() at K = 1 (the closed form, QuantLib-checked in rmql).
#   net     5 -> 32 -> 32 -> 1, tanh, full-batch Adam on the mean squared error. Seeds are fixed.
#   delta   dC/dS = c'(x1) exp(-x1), the derivative of the network with respect to its first input (backward pass).

suppressPackageStartupMessages({
  library(rmql)
  library(jsonlite)
})

seed <- 20261122L
hidden <- 32L
epochs <- 6000L
n_train <- 20000L; n_val <- 4000L; n_test <- 5000L
# the training range of each input: ln(S/K), T, sigma, r, q
lo <- c(-0.4, 0.1, 0.10, 0.00, 0.00)
hi <- c(0.4, 2.0, 0.50, 0.06, 0.04)
names_in <- c("log_moneyness", "time", "volatility", "rate", "dividend_yield")
mid <- (lo + hi) / 2; half <- (hi - lo) / 2

teacher <- function(x) {
  v <- compute_european_option_value("call", exp(x[, 1]), 1, x[, 4], x[, 5], x[, 3], x[, 2])
  list(price = v$value, delta = v$delta)   # K = 1: price = c, delta = dC/dS
}
draw <- function(n, lo, hi) sapply(seq_along(lo), function(j) runif(n, lo[j], hi[j]))

# ---- the network ---------------------------------------------------------------------------------------------------
scale_in <- function(x) sweep(sweep(x, 2, mid, "-"), 2, half, "/")
init_params <- function(seed) {
  set.seed(seed)
  glorot <- function(a, b) matrix(rnorm(a * b, 0, sqrt(2 / (a + b))), a, b)
  list(w1 = glorot(5L, hidden), b1 = rep(0, hidden), w2 = glorot(hidden, hidden), b2 = rep(0, hidden), w3 = glorot(hidden, 1L), b3 = 0)
}
forward <- function(p, u) {
  a1 <- tanh(sweep(u %*% p$w1, 2, p$b1, "+"))
  a2 <- tanh(sweep(a1 %*% p$w2, 2, p$b2, "+"))
  list(a1 = a1, a2 = a2, y = as.vector(a2 %*% p$w3) + p$b3)
}
loss_of <- function(p, u, target) mean((forward(p, u)$y - target)^2)
# the gradient by the chain rule of 11.3 (a dense layer: dW = a_prev' dz, dz = da * (1 - a^2)); du is the gradient with respect to the scaled input
backward <- function(p, u, target, with_input = FALSE) {
  fw <- forward(p, u); n <- nrow(u)
  dy <- 2 * (fw$y - target) / n
  dz2 <- (dy %*% t(p$w3)) * (1 - fw$a2^2)
  dz1 <- (dz2 %*% t(p$w2)) * (1 - fw$a1^2)
  g <- list(w1 = t(u) %*% dz1, b1 = colSums(dz1), w2 = t(fw$a1) %*% dz2, b2 = colSums(dz2), w3 = t(fw$a2) %*% matrix(dy), b3 = sum(dy))
  if (with_input) g$du <- dz1 %*% t(p$w1)
  g
}
# d output / d scaled input, per row (the backward pass with an output gradient of 1)
output_gradient <- function(p, u) {
  fw <- forward(p, u)
  dz2 <- matrix(p$w3, nrow(u), hidden, byrow = TRUE) * (1 - fw$a2^2)
  dz1 <- (dz2 %*% t(p$w2)) * (1 - fw$a1^2)
  dz1 %*% t(p$w1)
}
predict <- function(p, x) {
  u <- scale_in(x)
  price <- forward(p, u)$y
  dc_dx <- output_gradient(p, u) / rep(half, each = nrow(x)) * 1   # divided by the scaling of each input
  list(price = price, delta = dc_dx[, 1] * exp(-x[, 1]), d_log_moneyness = dc_dx[, 1])
}

# ---- the numerical gradient check ---------------------------------------------------------------------------------
check_gradients <- function(eps = 1e-6) {
  set.seed(1)
  u <- matrix(runif(8 * 5, -1, 1), 8, 5); target <- rnorm(8)
  p <- init_params(7L); p$b1 <- rnorm(hidden, 0, 0.1); p$b2 <- rnorm(hidden, 0, 0.1); p$b3 <- 0.1
  g <- backward(p, u, target, with_input = TRUE)
  worst <- function(analytic, numeric) max(abs(as.vector(analytic) - numeric)) / max(abs(as.vector(analytic)))
  numeric_of <- function(name) {
    base <- p[[name]]
    vapply(seq_along(base), function(i) {
      up <- p; up[[name]][i] <- base[i] + eps
      dn <- p; dn[[name]][i] <- base[i] - eps
      (loss_of(up, u, target) - loss_of(dn, u, target)) / (2 * eps)
    }, 0)
  }
  num_u <- vapply(seq_along(u), function(i) { up <- u; up[i] <- u[i] + eps; dn <- u; dn[i] <- u[i] - eps; (loss_of(p, up, target) - loss_of(p, dn, target)) / (2 * eps) }, 0)
  c(w1 = worst(g$w1, numeric_of("w1")), b1 = worst(g$b1, numeric_of("b1")), w2 = worst(g$w2, numeric_of("w2")), b2 = worst(g$b2, numeric_of("b2")),
    w3 = worst(g$w3, numeric_of("w3")), b3 = worst(g$b3, numeric_of("b3")), input = worst(g$du, num_u))
}
check <- check_gradients()
cat("gradient check (largest difference / largest entry):", paste(names(check), signif(check, 3), collapse = ", "), "\n")
stopifnot(max(check) < 1e-6)

# ---- data and training --------------------------------------------------------------------------------------------
set.seed(seed)
x_train <- draw(n_train, lo, hi); x_val <- draw(n_val, lo, hi); x_test <- draw(n_test, lo, hi)
y_train <- teacher(x_train)$price; y_val <- teacher(x_val)$price
u_train <- scale_in(x_train); u_val <- scale_in(x_val)

p <- init_params(seed)
m <- lapply(p, \(a) a * 0); v <- m
lr0 <- 5e-3; beta1 <- 0.9; beta2 <- 0.999
curve <- list()
t0 <- Sys.time()
for (epoch in seq_len(epochs)) {
  g <- backward(p, u_train, y_train)
  lr <- lr0 * (0.02 + 0.98 * 0.5 * (1 + cos(pi * epoch / epochs)))   # cosine decay to 2% of the first rate
  for (nm in names(p)) {
    m[[nm]] <- beta1 * m[[nm]] + (1 - beta1) * g[[nm]]
    v[[nm]] <- beta2 * v[[nm]] + (1 - beta2) * g[[nm]]^2
    p[[nm]] <- p[[nm]] - lr * (m[[nm]] / (1 - beta1^epoch)) / (sqrt(v[[nm]] / (1 - beta2^epoch)) + 1e-8)
  }
  if (epoch %% 50 == 0 || epoch == 1) curve[[length(curve) + 1L]] <- list(epoch = epoch, train_mse = loss_of(p, u_train, y_train), validation_mse = loss_of(p, u_val, y_val))
  if (epoch %% 1000 == 0) cat(sprintf("epoch %d: train %.3e, validation %.3e\n", epoch, curve[[length(curve)]]$train_mse, curve[[length(curve)]]$validation_mse))
}
elapsed <- as.numeric(difftime(Sys.time(), t0, units = "secs"))

# ---- errors: in the range, and out of it one input at a time ------------------------------------------------------
errors <- function(x) {
  tr <- teacher(x); pr <- predict(p, x)
  list(n = nrow(x), price_rmse = sqrt(mean((pr$price - tr$price)^2)), price_max_abs = max(abs(pr$price - tr$price)),
       delta_rmse = sqrt(mean((pr$delta - tr$delta)^2)), delta_max_abs = max(abs(pr$delta - tr$delta)), price_mean = mean(tr$price))
}
set.seed(seed + 1L)
mid_x <- function(n) draw(n, lo, hi)
outside <- function(j, a, b, n = 3000L) { x <- mid_x(n); x[, j] <- runif(n, a, b); x }
sets <- list(
  in_range = x_test,
  log_moneyness_far = { x <- mid_x(3000L); x[, 1] <- sample(c(-1, 1), 3000L, TRUE) * runif(3000L, 0.6, 1.0); x },
  time_long = outside(2, 3, 5), time_short = outside(2, 0.01, 0.05),
  volatility_high = outside(3, 0.6, 0.9), rate_high = outside(4, 0.08, 0.12), dividend_high = outside(5, 0.06, 0.10)
)
labels <- c(in_range = "学習範囲の中", log_moneyness_far = "ln(S/K) が範囲の外（0.6〜1.0 の絶対値）", time_long = "満期が長い（3〜5 年）", time_short = "満期が短い（0.01〜0.05 年）",
            volatility_high = "ボラティリティが高い（60〜90%）", rate_high = "金利が高い（8〜12%）", dividend_high = "配当利回りが高い（6〜10%）")
error_table <- lapply(names(sets), function(k) c(list(set = k, label = unname(labels[k])), errors(sets[[k]])))
for (e in error_table) cat(sprintf("%-18s price RMSE %.2e (max %.2e), delta RMSE %.2e (max %.2e)\n", e$set, e$price_rmse, e$price_max_abs, e$delta_rmse, e$delta_max_abs))

# ---- curves: along the log-moneyness and along the maturity, the others at 0.25, 3%, 1% ---------------------------------
base <- c(0, 1, 0.25, 0.03, 0.01)
along <- function(j, grid) {
  x <- matrix(rep(base, each = length(grid)), length(grid)); x[, j] <- grid
  tr <- teacher(x); pr <- predict(p, x)
  list(grid = grid, exact_price = tr$price, network_price = pr$price, exact_delta = tr$delta, network_delta = pr$delta)
}
curves <- list(log_moneyness = along(1, seq(-1, 1, length.out = 81)), time = along(2, seq(0.02, 4, length.out = 81)))

out <- list(
  meta = list(script = "server/scripts/cnn/train_bs_surrogate.R", rmql_version = as.character(packageVersion("rmql")), generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"), seed = seed,
              r_version = paste(R.version$major, R.version$minor, sep = "."), platform = R.version$platform, training_seconds = elapsed),
  settings = list(inputs = names_in, range_low = lo, range_high = hi, hidden = hidden, activation = "tanh", epochs = epochs, optimizer = "Adam, full batch, cosine decay", learning_rate = lr0,
                  n_train = n_train, n_validation = n_val, n_test = n_test, base_point = setNames(as.list(base), names_in)),
  gradient_check = as.list(check),
  weights = lapply(p, \(a) if (is.matrix(a)) lapply(seq_len(nrow(a)), \(i) a[i, ]) else as.list(a)),
  learning_curve = curve, errors = error_table, curves = curves
)
dir.create(file.path("server", "data", "cnn"), recursive = TRUE, showWarnings = FALSE)
path <- file.path("server", "data", "cnn", "bs_surrogate_results.json")
write_json(out, path, auto_unbox = TRUE, digits = NA, pretty = FALSE, na = "null")
cat(sprintf("written: %s (%.0f KB); training took %.0f s\n", normalizePath(path, winslash = "/"), file.size(path) / 1024, elapsed))
