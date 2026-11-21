# A 1D convolutional network for next-month changes of the JGB curve, walk-forward, against a random walk and a ridge
# regression (chapter 11.4). Pure R: the forward and backward passes are the formulas of 11.2 and 11.3, checked against
# numerical gradients before anything is trained. No deep-learning framework.
#
#   Rscript server/scripts/cnn/train_jgb_1d_cnn.R
#
# Data: server/data/jgb_curves/jgb_month_end.csv (Ministry of Finance, Japan; see PROVENANCE.md there).
# Writes: server/data/cnn/jgb_1d_cnn_results.json (metrics, the walk-forward predictions, kernels, the gradient check).
#
# Design (everything below uses only what was known at each origin month):
#   input   X_t  in R^{4 x 12}: the last 12 monthly changes (bp) of the 2Y, 5Y, 10Y and 20Y yields; channels = tenors
#   target  the change (bp) of each tenor from month t to t + 1
#   origin  every month from the first one with `min_train` training samples to the second last one
#   fit     an expanding window; models are refitted every `retrain_every` origins and kept in between
#   scaling channel and target scales are the standard deviations of the training window (no centering)
#   choice  the ridge penalty and the number of epochs are chosen on the last 20% of the training window (in time
#           order), then the model is refitted on the whole window
# The results are reported as they come out, including where the random walk is better.

suppressPackageStartupMessages({
  library(dplyr)
  library(purrr)
  library(tidyr)
  library(jsonlite)
})

settings <- list(
  tenors = c(2, 5, 10, 20), lookback = 12L, min_train = 120L, retrain_every = 6L,
  filters = 4L, kernel = 3L, l2 = 1e-3, learning_rate = 0.01, max_epochs = 300L, patience = 30L,
  validation_share = 0.2, seeds = 3L, base_seed = 20261122L,
  ridge_grid = 10^seq(-2, 3, length.out = 11)
)

root <- getwd()
csv <- file.path(root, "server", "data", "jgb_curves", "jgb_month_end.csv")
out_file <- file.path(root, "server", "data", "cnn", "jgb_1d_cnn_results.json")
stopifnot(file.exists(csv))

# ---- data: changes in bp, one row per month ---------------------------------------------------------------------

curve <- read.csv(csv) |>
  filter(tenor_years %in% settings$tenors) |>
  select(month, date, tenor_years, yield_pct) |>
  pivot_wider(names_from = tenor_years, values_from = yield_pct, names_prefix = "y") |>
  arrange(month)
stopifnot(nrow(curve) == 442L, !anyNA(curve))
yields <- as.matrix(curve[paste0("y", settings$tenors)])
changes <- diff(yields) * 100   # row r: the change from month r to month r + 1 (bp)
n_chg <- nrow(changes)
n_ch <- ncol(changes)
dates <- curve$date               # dates[r + 1] is the month of changes[r, ]

# ---- samples ----------------------------------------------------------------------------------------------------
# A sample with origin row j: input rows j - lookback + 1, ..., j; target row j + 1 (known at the end of month j + 1).

make_samples <- function(origins) {
  lb <- settings$lookback
  x <- array(0, c(length(origins), n_ch, lb))
  for (k in seq_along(origins)) x[k, , ] <- t(changes[(origins[k] - lb + 1):origins[k], , drop = FALSE])
  list(x = x, y = changes[origins + 1L, , drop = FALSE], origin = origins)
}

# ---- the network: conv1d (valid, stride 1) -> ReLU -> flatten -> dense --------------------------------------------

lout <- settings$lookback - settings$kernel + 1L

# im2col: rows (n, t) with t fastest, columns (c, k): U[(n,t), (c,k)] = x[n, c, t + k - 1]
im2col <- function(x) {
  n <- dim(x)[1]; kk <- settings$kernel
  cols <- vector("list", n_ch * kk)
  for (c in seq_len(n_ch)) for (k in seq_len(kk)) {
    cols[[(c - 1L) * kk + k]] <- as.vector(t(x[, c, k:(k + lout - 1L), drop = FALSE][, 1, ]))
  }
  do.call(cbind, cols)
}

init_params <- function(seed) {
  set.seed(seed)
  f <- settings$filters; kk <- settings$kernel
  list(
    wc = matrix(rnorm(f * n_ch * kk, 0, sqrt(2 / (n_ch * kk))), f, n_ch * kk),
    bc = rep(0, f),
    wd = matrix(rnorm(f * lout * n_ch, 0, sqrt(1 / (f * lout))) * 0.5, f * lout, n_ch),
    bd = rep(0, n_ch)
  )
}

forward <- function(p, u, n) {
  z <- sweep(u %*% t(p$wc), 2, p$bc, "+")
  a <- pmax(z, 0)
  h <- matrix(aperm(array(a, c(lout, n, settings$filters)), c(2, 1, 3)), n, lout * settings$filters)
  list(z = z, h = h, y = sweep(h %*% p$wd, 2, p$bd, "+"))
}

loss_of <- function(p, u, n, target, l2 = settings$l2) {
  mean((forward(p, u, n)$y - target)^2) + l2 * (sum(p$wc^2) + sum(p$wd^2))
}

# the gradient by the chain rule of 11.3; `dx` is the gradient with respect to the input (a transposed convolution)
backward <- function(p, u, n, target, l2 = settings$l2, with_input = FALSE) {
  fw <- forward(p, u, n)
  dy <- 2 * (fw$y - target) / (n * n_ch)
  dh <- dy %*% t(p$wd)
  da <- matrix(aperm(array(dh, c(n, lout, settings$filters)), c(2, 1, 3)), lout * n, settings$filters)
  dz <- da * (fw$z > 0)
  g <- list(wc = t(dz) %*% u + 2 * l2 * p$wc, bc = colSums(dz), wd = t(fw$h) %*% dy + 2 * l2 * p$wd, bd = colSums(dy))
  if (with_input) {
    du <- dz %*% p$wc
    kk <- settings$kernel
    dx <- array(0, c(n, n_ch, settings$lookback))
    for (c in seq_len(n_ch)) for (k in seq_len(kk)) {
      dx[, c, k:(k + lout - 1L)] <- dx[, c, k:(k + lout - 1L)] + t(matrix(du[, (c - 1L) * kk + k], lout, n))
    }
    g$dx <- dx
  }
  g
}

# ---- the numerical gradient check -------------------------------------------------------------------------------

check_gradients <- function(eps = 1e-6) {
  set.seed(1)
  n <- 6L
  x <- array(rnorm(n * n_ch * settings$lookback), c(n, n_ch, settings$lookback))
  target <- matrix(rnorm(n * n_ch), n, n_ch)
  p <- init_params(7L)
  p$bc <- rnorm(settings$filters, 0, 0.1); p$bd <- rnorm(n_ch, 0, 0.1)
  l2 <- 1e-2
  u <- im2col(x)
  g <- backward(p, u, n, target, l2, with_input = TRUE)
  # the largest difference, relative to the largest gradient entry: elementwise relative errors blow up where an entry is
  # near 0, and a central difference has an absolute rounding error of about 1e-16 / eps
  worst <- function(analytic, numeric) max(abs(as.vector(analytic) - numeric)) / max(abs(as.vector(analytic)))
  numeric_of <- function(name) {
    base <- p[[name]]
    map_dbl(seq_along(base), function(i) {
      up <- p; up[[name]][i] <- base[i] + eps
      dn <- p; dn[[name]][i] <- base[i] - eps
      (loss_of(up, u, n, target, l2) - loss_of(dn, u, n, target, l2)) / (2 * eps)
    })
  }
  num_x <- map_dbl(seq_along(x), function(i) {
    up <- x; up[i] <- x[i] + eps
    dn <- x; dn[i] <- x[i] - eps
    (loss_of(p, im2col(up), n, target, l2) - loss_of(p, im2col(dn), n, target, l2)) / (2 * eps)
  })
  c(
    kernel = worst(g$wc, numeric_of("wc")), conv_bias = worst(g$bc, numeric_of("bc")),
    dense_weight = worst(g$wd, numeric_of("wd")), dense_bias = worst(g$bd, numeric_of("bd")),
    input = worst(g$dx, num_x)
  )
}

# ---- training (Adam, full batch) ----------------------------------------------------------------------------------

adam_fit <- function(p, u, n, target, epochs, val = NULL, patience = Inf) {
  m <- map(p, \(a) a * 0); v <- m
  b1 <- 0.9; b2 <- 0.999; lr <- settings$learning_rate
  best <- list(loss = Inf, epoch = 0L, params = p)
  waited <- 0L
  for (t in seq_len(epochs)) {
    g <- backward(p, u, n, target)
    for (nm in names(p)) {
      m[[nm]] <- b1 * m[[nm]] + (1 - b1) * g[[nm]]
      v[[nm]] <- b2 * v[[nm]] + (1 - b2) * g[[nm]]^2
      p[[nm]] <- p[[nm]] - lr * (m[[nm]] / (1 - b1^t)) / (sqrt(v[[nm]] / (1 - b2^t)) + 1e-8)
    }
    if (!is.null(val)) {
      l <- mean((forward(p, val$u, val$n)$y - val$target)^2)
      if (l < best$loss) { best <- list(loss = l, epoch = t, params = p); waited <- 0L } else waited <- waited + 1L
      if (waited >= patience) break
    }
  }
  if (is.null(val)) list(params = p, epoch = epochs) else best
}

# ---- scaling and the three models ---------------------------------------------------------------------------------

fit_models <- function(train, seed) {
  n <- length(train$origin)
  n_val <- max(1L, round(settings$validation_share * n))
  fit_idx <- seq_len(n - n_val); val_idx <- (n - n_val + 1L):n
  x_scale <- apply(train$x, 2, sd)      # one scale per channel
  y_scale <- apply(train$y, 2, sd)
  scale_x <- \(x) sweep(x, 2, x_scale, "/")
  scale_y <- \(y) sweep(y, 2, y_scale, "/")
  prep <- function(idx) {
    x <- scale_x(train$x[idx, , , drop = FALSE]); y <- scale_y(train$y[idx, , drop = FALSE])
    list(x = x, y = y, u = im2col(x), n = length(idx), target = y)
  }
  part <- prep(fit_idx); val <- prep(val_idx); all <- prep(seq_len(n))

  # ridge on the 48 flattened inputs, with an intercept that is not penalized
  flat <- \(x) matrix(x, dim(x)[1])
  ridge_solve <- function(xf, y, lambda) {
    mx <- colMeans(xf); my <- colMeans(y)
    xc <- sweep(xf, 2, mx); yc <- sweep(y, 2, my)
    w <- solve(crossprod(xc) + lambda * diag(ncol(xc)), crossprod(xc, yc))
    list(w = w, mx = mx, my = my)
  }
  ridge_predict <- \(m, xf) sweep(sweep(xf, 2, m$mx) %*% m$w, 2, m$my, "+")
  val_loss <- map_dbl(settings$ridge_grid, \(l) mean((ridge_predict(ridge_solve(flat(part$x), part$y, l), flat(val$x)) - val$y)^2))
  lambda <- settings$ridge_grid[which.min(val_loss)]
  ridge <- ridge_solve(flat(all$x), all$y, lambda)

  # the network: the epoch count from the validation part, then refitted on the whole window; the average of a few seeds
  nets <- map(seq_len(settings$seeds), function(s) {
    chosen <- adam_fit(init_params(seed + s), part$u, part$n, part$target, settings$max_epochs, val, settings$patience)
    adam_fit(init_params(seed + s), all$u, all$n, all$target, max(chosen$epoch, 1L))
  })

  list(
    predict = function(x) {   # x: samples x channel x time, in bp; returns the predicted changes in bp
      xs <- scale_x(x)
      u <- im2col(xs)
      cnn <- Reduce(`+`, map(nets, \(m) forward(m$params, u, dim(x)[1])$y)) / length(nets)
      list(ridge = sweep(ridge_predict(ridge, flat(xs)), 2, y_scale, "*"), cnn = sweep(cnn, 2, y_scale, "*"))
    },
    info = list(ridge_lambda = lambda, epochs = map_int(nets, "epoch"), x_scale = x_scale, y_scale = y_scale),
    kernel = nets[[1]]$params$wc
  )
}

# ---- gradient check, then walk-forward ----------------------------------------------------------------------------

grad_check <- check_gradients()
cat("gradient check (largest difference / largest entry, analytic vs central difference):\n")
print(signif(grad_check, 3))
if (max(grad_check) > 1e-6) stop("the analytic gradients do not match the numerical ones: ", max(grad_check))

first_origin <- settings$lookback + settings$min_train        # the first origin row to forecast from
origins <- first_origin:(n_chg - 1L)
all_samples <- make_samples(settings$lookback:(n_chg - 1L))
sample_of <- \(origin) which(all_samples$origin == origin)

cat(sprintf("forecast origins: %d (months %s to %s); refit every %d\n", length(origins),
            dates[first_origin + 1L], dates[max(origins) + 1L], settings$retrain_every))

started <- Sys.time()
fits <- list()
rows <- vector("list", length(origins))
for (i in seq_along(origins)) {
  o <- origins[i]
  if ((i - 1L) %% settings$retrain_every == 0L) {
    keep <- which(all_samples$origin <= o - 1L)    # their targets (row <= o) are known at the origin
    train <- list(x = all_samples$x[keep, , , drop = FALSE], y = all_samples$y[keep, , drop = FALSE], origin = all_samples$origin[keep])
    model <- fit_models(train, settings$base_seed + o * 10L)
    fits[[length(fits) + 1L]] <- list(origin_month = dates[o + 1L], train_samples = length(keep), kernel = model$kernel, info = model$info)
  }
  s <- sample_of(o)
  pred <- model$predict(all_samples$x[s, , , drop = FALSE])
  rows[[i]] <- list(origin = dates[o + 1L], target_month = dates[o + 2L], actual = as.vector(changes[o + 1L, ]),
                    random_walk = rep(0, n_ch), ridge = as.vector(pred$ridge), cnn = as.vector(pred$cnn))
  if (i %% 25L == 0L) cat(sprintf("  %d / %d  (%.0f s)\n", i, length(origins), as.numeric(difftime(Sys.time(), started, units = "secs"))))
}

# ---- metrics ------------------------------------------------------------------------------------------------------

mat <- \(field) do.call(rbind, map(rows, field))
actual <- mat("actual")
errors <- list(random_walk = actual - mat("random_walk"), ridge = actual - mat("ridge"), cnn = actual - mat("cnn"))
target_month <- map_chr(rows, "target_month")
periods <- list(
  all = rep(TRUE, length(rows)),
  first_half = seq_along(rows) <= length(rows) / 2,
  second_half = seq_along(rows) > length(rows) / 2,
  since_2022 = target_month >= "2022-01-01"
)
metric_table <- function(sel) {
  imap_dfr(errors, function(e, model) {
    e <- e[sel, , drop = FALSE]
    tibble(model = model, tenor = c(paste0(settings$tenors, "Y"), "all"),
           rmse = c(sqrt(colMeans(e^2)), sqrt(mean(e^2))), mae = c(colMeans(abs(e)), mean(abs(e))), months = nrow(e))
  })
}
metrics <- imap(periods, \(sel, nm) metric_table(sel))
beats <- map_dbl(c("ridge", "cnn"), \(m) mean(rowMeans(errors[[m]]^2) < rowMeans(errors$random_walk^2)))
names(beats) <- c("ridge", "cnn")

cat("\nout-of-sample RMSE / MAE in bp, all tenors pooled:\n")
iwalk(metrics, function(tab, nm) {
  cat(sprintf("  %-12s", nm))
  pooled <- tab |> filter(tenor == "all")
  cat(paste(sprintf("%s RMSE %.3f MAE %.3f", pooled$model, pooled$rmse, pooled$mae), collapse = "   "), sprintf("  (%d months)\n", pooled$months[1]))
})
cat("share of months in which the model's squared error is below the random walk's:\n"); print(round(beats, 3))
cat("\nper tenor, all months:\n"); print(as.data.frame(metrics$all |> mutate(across(c(rmse, mae), \(x) round(x, 3)))), row.names = FALSE)

# ---- write --------------------------------------------------------------------------------------------------------

round_list <- \(x) map(x, \(v) round(v, 4))
result <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  data = list(file = "server/data/jgb_curves/jgb_month_end.csv", months = nrow(curve), first = curve$date[1], last = curve$date[nrow(curve)]),
  settings = settings[setdiff(names(settings), "ridge_grid")],
  units = "bp: monthly changes of the 2Y, 5Y, 10Y and 20Y yields; kernels are in standardized units",
  gradient_check = as.list(signif(grad_check, 3)),
  metrics = map(metrics, \(tab) tab),
  share_of_months_better_than_random_walk = as.list(round(beats, 4)),
  predictions = map(rows, \(r) list(origin = r$origin, target_month = r$target_month, actual = round(r$actual, 3), ridge = round(r$ridge, 3), cnn = round(r$cnn, 3))),
  fits = map(fits, \(f) list(origin_month = f$origin_month, train_samples = f$train_samples, ridge_lambda = f$info$ridge_lambda,
                             epochs = f$info$epochs, kernel = round(f$kernel, 5)))
)
dir.create(dirname(out_file), recursive = TRUE, showWarnings = FALSE)
write_json(result, out_file, auto_unbox = TRUE, digits = NA, pretty = FALSE)
cat(sprintf("\nwritten: %s (%.0f KB, %.0f s)\n", out_file, file.size(out_file) / 1024, as.numeric(difftime(Sys.time(), started, units = "secs"))))
