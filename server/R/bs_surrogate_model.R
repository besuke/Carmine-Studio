# Chapter 11.5: a fully connected network that learned the Black-Scholes call price. It was trained offline by
# server/scripts/cnn/train_bs_surrogate.R (which wrote server/data/cnn/bs_surrogate_results.json); nothing is trained here. The
# server runs the network forward from the saved weights, takes its derivative with respect to the input (the backward pass of
# 11.3) and sets both against rmql's closed form (compute_european_option_value, QuantLib-checked in rmql). Needs lookback_model.R
# (the checks and the error of a request out of range).
#
# POST /api/cnn/bs-surrogate  {"spot": 100, "strike": 100, "ratePct": 3, "dividendYieldPct": 1, "volatilityPct": 25, "time": 1}
# GET  /api/cnn/bs-summary    the saved training results (without the weights): the learning curve, the errors in and out of the
#                             training range, the curves of the network and of the closed form
# A request outside the training range is answered (with a warning), not refused: the page is to show what happens there.

BS_RESULTS_FILE <- file.path(script_dir, "data", "cnn", "bs_surrogate_results.json")
BS_CACHE <- new.env()

bs_results <- function() {
  if (!is.null(BS_CACHE$results)) return(BS_CACHE$results)
  if (!file.exists(BS_RESULTS_FILE)) stop("server/data/cnn/bs_surrogate_results.json がありません。Rscript server/scripts/cnn/train_bs_surrogate.R で作ってください。")
  r <- jsonlite::fromJSON(BS_RESULTS_FILE, simplifyVector = TRUE)
  w <- r$weights
  net <- list(w1 = as.matrix(w$w1), b1 = as.numeric(w$b1), w2 = as.matrix(w$w2), b2 = as.numeric(w$b2), w3 = matrix(as.numeric(w$w3), ncol = 1L), b3 = as.numeric(w$b3))
  lo <- as.numeric(r$settings$range_low); hi <- as.numeric(r$settings$range_high)
  BS_CACHE$net <- net; BS_CACHE$lo <- lo; BS_CACHE$hi <- hi; BS_CACHE$mid <- (lo + hi) / 2; BS_CACHE$half <- (hi - lo) / 2
  BS_CACHE$results <- r
  r
}

# The network's c = C / K and its derivatives with respect to the five inputs (x = ln(S/K), T, sigma, r, q), for one row.
bs_net <- function(x) {
  bs_results()
  n <- BS_CACHE$net; mid <- BS_CACHE$mid; half <- BS_CACHE$half
  u <- matrix((x - mid) / half, 1L)
  a1 <- tanh(u %*% n$w1 + n$b1)
  a2 <- tanh(a1 %*% n$w2 + n$b2)
  y <- as.numeric(a2 %*% n$w3) + n$b3
  dz2 <- t(n$w3) * (1 - a2^2)
  dz1 <- (dz2 %*% t(n$w2)) * (1 - a1^2)
  list(price = y, gradient = as.numeric(dz1 %*% t(n$w1)) / half)   # d c / d x_j
}

bs_surrogate_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("spot", "strike", "ratePct", "dividendYieldPct", "volatilityPct", "time"))
  spot <- p16_num(body$spot, "現物", 1e-6, 1e6, 100)
  strike <- p16_num(body$strike, "行使価格", 1e-6, 1e6, 100)
  rate <- p16_num(body$ratePct, "金利（%）", -5, 30, 3) / 100
  dividend <- p16_num(body$dividendYieldPct, "配当利回り（%）", -5, 30, 1) / 100
  volatility <- p16_num(body$volatilityPct, "ボラティリティ（%）", 1, 200, 25) / 100
  time <- p16_num(body$time, "満期（年）", 0.01, 30, 1)
  bs_results()
  x <- c(log(spot / strike), time, volatility, rate, dividend)
  labels <- c("ln(S/K)", "満期（年）", "ボラティリティ", "金利", "配当利回り")
  inside <- x >= BS_CACHE$lo - 1e-12 & x <= BS_CACHE$hi + 1e-12
  shown <- function(j, v) if (j == 1L) sprintf("%.3f", v) else if (j == 2L) sprintf("%.2f", v) else sprintf("%.1f%%", 100 * v)
  fmt_range <- function(j) paste0(shown(j, BS_CACHE$lo[j]), "〜", shown(j, BS_CACHE$hi[j]))
  warnings <- vapply(which(!inside), \(j) sprintf("%s = %s は学習範囲（%s）の外です。ネットワークの値は、外挿で、信用できません。", labels[j], shown(j, x[j]), fmt_range(j)), "")
  net <- bs_net(x)
  exact <- p16_rmql(rmql::compute_european_option_value("call", spot, strike, rate, dividend, volatility, time))
  network_price <- strike * net$price
  network_delta <- net$gradient[1] * exp(-x[1])
  list(
    inputs = list(spot = spot, strike = strike, ratePct = 100 * rate, dividendYieldPct = 100 * dividend, volatilityPct = 100 * volatility, time = time),
    network = list(price = network_price, delta = network_delta, scaled_price = net$price, log_moneyness = x[1]),
    exact = list(price = exact$value, delta = exact$delta),
    error = list(price = network_price - exact$value, price_relative = (network_price - exact$value) / exact$value, delta = network_delta - exact$delta),
    in_range = stats::setNames(as.list(inside), c("log_moneyness", "time", "volatility", "rate", "dividend_yield")),
    warnings = as.list(unname(warnings)),
    training_range = list(low = BS_CACHE$lo, high = BS_CACHE$hi),
    conventions = list(
      network = "価格は S と K について 1 次同次なので、入力は (ln(S/K), 満期, ボラティリティ, 金利, 配当利回り) の 5 つ、出力は C/K。全結合 5-32-32-1、tanh",
      delta = "ネットワークのデルタ = c'(ln(S/K)) / (S/K)。c' は、入力に対するバックワードパス（11.3 の連鎖律）で求める",
      exact = "ブラック・ショールズの閉じた式"
    )
  )
}

bs_summary <- function() {
  r <- bs_results()
  r$weights <- NULL
  r$engine <- paste("rmql", as.character(utils::packageVersion("rmql")))
  r
}
