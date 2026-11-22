# Lookback options (chapter 13.2). The calculation is rmql's: the closed form of the continuously monitored option and the
# binomial tree of the discretely monitored one (compute_lookback_option_value, compute_discrete_lookback_option_value). The
# page asks for one point; the convergence study and the Monte Carlo comparison are precomputed (server/data/p16/).
#
# POST /api/lookback
#   {"lookbackType": "floating", "optionType": "call", "spot": 100, "runningExtremum": 100, "strike": null,
#    "ratePct": 3, "dividendYieldPct": 1, "volatilityPct": 25, "time": 1, "monitoringCount": 12, "steps": 360}
# Every field is optional (the defaults are the ones above). `monitoringCount` 0 gives the continuous value only.
# A limit of the table in docs/part3_chapters_13_15_spec.md (7) exceeded is HTTP 400 with a message in Japanese.

P16_SETTLEMENT <- "2026-11-02"

# The limits of the live APIs: each keeps a call under 0.3 s on the development PC (docs/part3_chapters_13_15_spec.md, 7).
P16_LIMITS <- list(
  lookback = list(steps = c(2L, 400L)),
  convertible = list(steps = c(2L, 300L), callabilities = 10L, remaining_years = c(1L, 30L)),
  mscb = list(steps = c(2L, 400L), reset_dates = 12L, price_nodes = c(2L, 80L), grid_work = 32000L)
)

p16_bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))

p16_fmt <- function(x) format(x, big.mark = ",", scientific = FALSE, trim = TRUE)

# A number of the body, with a default and a range; `whole` asks for an integer.
p16_num <- function(x, label, lo, hi, default, whole = FALSE) {
  if (is.null(x)) x <- default
  if (!(is.numeric(x) && length(x) == 1L && is.finite(x))) p16_bad(sprintf("%sは数値で指定してください", label))
  if (whole && x != round(x)) p16_bad(sprintf("%sは整数にしてください", label))
  if (x < lo || x > hi) p16_bad(sprintf("%sは %s〜%s にしてください", label, p16_fmt(lo), p16_fmt(hi)))
  x
}

p16_choice <- function(x, label, choices, default) {
  if (is.null(x)) x <- default
  if (!(is.character(x) && length(x) == 1L && x %in% choices)) p16_bad(sprintf("%sは %s のどれかにしてください", label, paste(choices, collapse = "・")))
  x
}

p16_unknown <- function(body, allowed, where = "") {
  unknown <- setdiff(names(body), allowed)
  if (length(unknown)) p16_bad(sprintf("不明な項目です：%s%s", where, unknown[1]))
}

# The Greeks of the first row of an rmql table.
p16_values <- function(row, columns) {
  out <- lapply(columns, \(k) as.numeric(row[[k]][1]))
  stats::setNames(out, columns)
}

# An error of rmql about the input of a request that passed the checks above is the request's, not the server's.
p16_rmql <- function(expr) {
  tryCatch(expr, tona_bad_request = function(e) stop(e),
           error = function(e) p16_bad(paste0("この入力は計算できません：", conditionMessage(e))))
}

LOOKBACK_COLUMNS <- c("value", "delta", "gamma", "vega", "rho", "dividend_rho", "theta", "strike_sensitivity", "extremum_sensitivity")

lookback_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("lookbackType", "optionType", "spot", "runningExtremum", "strike", "ratePct", "dividendYieldPct", "volatilityPct", "time",
                      "monitoringCount", "steps"))
  type <- p16_choice(body$lookbackType, "lookbackType", c("floating", "fixed"), "floating")
  kind <- p16_choice(body$optionType, "optionType", c("call", "put"), "call")
  spot <- p16_num(body$spot, "現物", 1e-6, 1e6, 100)
  extremum <- p16_num(body$runningExtremum, "これまでの最小値・最大値", 1e-6, 1e6, spot)
  min_tracked <- (type == "floating" && kind == "call") || (type == "fixed" && kind == "put")
  if (min_tracked && extremum > spot) p16_bad("これまでの最小値は、現物以下にしてください（この組み合わせは最小値を使います）")
  if (!min_tracked && extremum < spot) p16_bad("これまでの最大値は、現物以上にしてください（この組み合わせは最大値を使います）")
  strike <- NA_real_
  if (type == "fixed") strike <- p16_num(body$strike, "行使価格", 1e-6, 1e6, NULL)
  rate <- p16_num(body$ratePct, "金利（%）", -5, 30, 3) / 100
  dividend <- p16_num(body$dividendYieldPct, "配当利回り（%）", -5, 30, 1) / 100
  volatility <- p16_num(body$volatilityPct, "ボラティリティ（%）", 1, 200, 25) / 100
  time <- p16_num(body$time, "満期（年）", 0.05, 30, 1)
  lim <- P16_LIMITS$lookback
  steps <- p16_num(body$steps, "段数", lim$steps[1], lim$steps[2], 360, whole = TRUE)
  monitoring <- p16_num(body$monitoringCount, "監視の回数", 0, steps, min(12, steps), whole = TRUE)

  continuous <- p16_rmql(rmql::compute_lookback_option_value(type, kind, spot, extremum, strike, rate, dividend, volatility, time))
  discrete <- NULL
  times <- numeric()
  if (monitoring > 0) {
    times <- (seq_len(monitoring) / monitoring) * time
    discrete <- p16_rmql(rmql::compute_discrete_lookback_option_value(type, kind, spot, extremum, strike, rate, dividend, volatility, time,
                                                                       monitoring_times = times, steps = as.integer(steps)))
  }
  list(
    inputs = list(lookbackType = type, optionType = kind, spot = spot, runningExtremum = extremum, strike = if (is.na(strike)) NULL else strike,
                  ratePct = 100 * rate, dividendYieldPct = 100 * dividend, volatilityPct = 100 * volatility, time = time,
                  monitoringCount = monitoring, steps = steps),
    continuous = p16_values(continuous, LOOKBACK_COLUMNS),
    discrete = if (is.null(discrete)) NULL else p16_values(discrete, LOOKBACK_COLUMNS),
    monitoring_times = times,
    limits = lim,
    conventions = list(
      continuous = "連続監視の閉じた式（Goldman–Sosin–Gatto、Conze–Viswanathan）。ドリフトが 0 のときは極限の値",
      discrete = "監視日ごとに最小値（最大値）を更新する、価格と最小値の比 z = S/m の二項木（CRR）。監視日は最も近い段に置く",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}
