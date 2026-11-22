# The 1D-CNN experiment of chapter 11.4: next-month changes of the JGB curve and what they do to a bond.
#
# The network, the ridge regression and the random walk were trained and evaluated offline, walk-forward, by
# server/scripts/cnn/train_jgb_1d_cnn.R, which wrote server/data/cnn/jgb_1d_cnn_results.json. Nothing is trained here.
# The server reads that file and values a bond with rmql on four curves of the month after the chosen month:
# the realized one, the 1D-CNN forecast, the ridge forecast and the random walk (no change).
#
# GET  /api/cnn/jgb-summary   -> settings, gradient check, metrics, rolling errors, kernels, the months that can be chosen
# POST /api/cnn/jgb-forecast  {"month": "202101", "bond": {"remainingYears": 10, "couponPct": 1, "faceAmount": 100}}
#
# The curves have four nodes (2Y, 5Y, 10Y, 20Y), the tenors the models forecast, so that the realized and forecast curves
# are built in the same way. Each node's yield becomes a discount factor (1 + y)^-t, and a monotonic log-cubic discount
# curve goes through them (as in jgb_curve_model.R, which uses all of the month's tenors). The bond is a semiannual
# fixed-rate bond issued at the chosen month-end with a remaining life of 2 to 20 whole years, so that it lies between the
# nodes. Its profit and loss is its value on the curve of the next month-end, one month older, less its value now:
# the carry and the time passed are in it. The same bond is valued under every scenario.

CNN_RESULTS_FILE <- file.path(script_dir, "data", "cnn", "jgb_1d_cnn_results.json")
CNN_CACHE <- new.env()
CNN_TENORS <- c(2, 5, 10, 20)
CNN_DEFAULTS <- list(month = NULL, bond = list(remainingYears = 10, couponPct = 1, faceAmount = 100))

cnn_results <- function() {
  if (!is.null(CNN_CACHE$results)) return(CNN_CACHE$results)
  if (!file.exists(CNN_RESULTS_FILE)) stop("server/data/cnn/jgb_1d_cnn_results.json がありません。Rscript server/scripts/cnn/train_jgb_1d_cnn.R で作ってください。")
  r <- jsonlite::fromJSON(CNN_RESULTS_FILE, simplifyVector = TRUE)
  # one row per forecast origin, one column per tenor
  as_matrix <- \(x) if (is.matrix(x)) x else do.call(rbind, x)
  for (k in c("actual", "ridge", "cnn")) r$predictions[[k]] <- as_matrix(r$predictions[[k]])
  CNN_CACHE$results <- r
  r
}

# The month-end yields of the four tenors, one row per month (percent).
cnn_yields <- function() {
  if (!is.null(CNN_CACHE$yields)) return(CNN_CACHE$yields)
  y <- readr::read_csv(JGB_CURVE_FILE, col_types = readr::cols(month = "c", date = "c", .default = "d")) |>
    dplyr::filter(tenor_years %in% CNN_TENORS) |>
    dplyr::arrange(month, tenor_years) |>
    tidyr::pivot_wider(names_from = tenor_years, values_from = yield_pct, names_prefix = "y")
  CNN_CACHE$yields <- y
  y
}

cnn_curve <- function(ref, yield_pct) {
  node_dates <- ref + round(365.25 * CNN_TENORS)
  t <- as.numeric(node_dates - ref) / 365
  df <- (1 + yield_pct / 100)^(-t)
  rmql::with_extrapolation(rmql::create_discount_curve(c(ref, node_dates), c(1, df), "actual_365_fixed", "monotonic_log_cubic"))
}

cnn_zero_grid <- function(curve, ref) {
  grid <- seq(0.5, 20, by = 0.5)
  list(years = grid, yield_pct = round(100 * rmql::compute_zero_rate(curve, ref + round(365.25 * grid), "actual_365_fixed", "compounded", 1L), 4))
}

cnn_summary <- function() {
  r <- cnn_results()
  p <- r$predictions
  err <- function(m) p$actual - m
  mse <- function(e) rowMeans(e^2)
  window <- 24L
  rolling <- function(e) {
    s <- mse(e)
    vapply(seq_along(s), \(i) if (i < window) NA_real_ else sqrt(mean(s[(i - window + 1L):i])), 0)
  }
  zero <- matrix(0, nrow(p$actual), ncol(p$actual))
  list(
    settings = r$settings, data = r$data, generated = r$generated, gradient_check = r$gradient_check,
    metrics = r$metrics,
    share_better_than_random_walk = r$share_of_months_better_than_random_walk,
    months = list(origin = p$origin, target = p$target_month),
    rolling_rmse_window = window,
    rolling_rmse = list(
      random_walk = round(rolling(err(zero)), 4), ridge = round(rolling(err(p$ridge)), 4), cnn = round(rolling(err(p$cnn)), 4)
    ),
    kernels = list(
      origin_month = r$fits$origin_month, train_samples = r$fits$train_samples,
      last = r$fits$kernel[[length(r$fits$kernel)]], first = r$fits$kernel[[1]]
    ),
    conventions = list(
      note = "学習と評価はオフラインで行いました（server/scripts/cnn/train_jgb_1d_cnn.R）。この API は、保存された結果を返すだけです。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

cnn_forecast <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  unknown <- setdiff(names(body), c("month", "bond"))
  if (length(unknown)) bad(sprintf("unknown field %s", unknown[1]))
  given <- body$bond
  if (!is.null(given) && !is.list(given)) bad("bond must be an object")
  unknown <- setdiff(names(given), names(CNN_DEFAULTS$bond))
  if (length(unknown)) bad(sprintf("unknown field bond.%s", unknown[1]))
  b <- utils::modifyList(CNN_DEFAULTS$bond, if (is.null(given)) list() else given)
  num1 <- \(x) is.numeric(x) && length(x) == 1L && is.finite(x)
  if (!(num1(b$remainingYears) && b$remainingYears == round(b$remainingYears) && b$remainingYears >= 2 && b$remainingYears <= 20)) bad("残存年限は 2〜20 の整数にしてください")
  if (!(num1(b$couponPct) && b$couponPct >= 0 && b$couponPct <= 10)) bad("クーポンは 0〜10% にしてください")
  if (!(num1(b$faceAmount) && b$faceAmount >= 1 && b$faceAmount <= 1e9)) bad("額面は 1〜1,000,000,000 にしてください")

  res <- cnn_results()
  p <- res$predictions
  month <- body$month
  if (!(is.character(month) && length(month) == 1L && grepl("^[0-9]{6}$", month))) bad("month は \"202101\" のような年月（6 桁）にしてください")
  row <- which(substr(gsub("-", "", p$origin), 1, 6) == month)
  if (length(row) != 1L) bad(sprintf("%s は予測の対象月ではありません（%s〜%s）", month, substr(gsub("-", "", p$origin[1]), 1, 6), substr(gsub("-", "", p$origin[length(p$origin)]), 1, 6)))

  y <- cnn_yields()
  now <- y[y$month == month, ]
  nxt <- y[y$month == substr(gsub("-", "", p$target_month[row]), 1, 6), ]
  stopifnot(nrow(now) == 1L, nrow(nxt) == 1L)
  cols <- paste0("y", CNN_TENORS)
  y_now <- unlist(now[cols], use.names = FALSE)
  y_next <- unlist(nxt[cols], use.names = FALSE)
  change <- list(actual = p$actual[row, ], cnn = p$cnn[row, ], ridge = p$ridge[row, ], random_walk = rep(0, length(CNN_TENORS)))
  scenario_yield <- list(
    actual = y_next, cnn = y_now + change$cnn / 100, ridge = y_now + change$ridge / 100, random_walk = y_now
  )
  # the realized change must be the one the model was scored on (a check that the two files agree)
  if (max(abs((y_next - y_now) * 100 - change$actual)) > 1e-6) stop("the realized change in the results file differs from the yield data")

  d_now <- as.Date(now$date)
  d_next <- as.Date(nxt$date)
  bond <- rmql::create_fixed_rate_bond(
    0L, b$faceAmount, d_now, seq(d_now, by = paste(12L * as.integer(b$remainingYears), "months"), length.out = 2L)[2], "6M", "japan", "following",
    "following", "backward", FALSE, b$couponPct / 100, "actual_365_fixed", "following", 100
  )
  curve_now <- cnn_curve(d_now, y_now)
  v_now <- rmql::compute_bond_value_on_curve(bond, curve_now, d_now)
  scenarios <- c(actual = "実績（翌月の実際のカーブ）", cnn = "1D-CNN 予測", ridge = "リッジ回帰の予測", random_walk = "ランダムウォーク（変化なし）")
  curves <- lapply(names(scenarios), \(k) cnn_curve(d_next, scenario_yield[[k]]))
  names(curves) <- names(scenarios)
  values <- lapply(names(scenarios), \(k) rmql::compute_bond_value_on_curve(bond, curves[[k]], d_next))
  names(values) <- names(scenarios)
  actual_pnl <- values$actual$npv - v_now$npv
  valuation <- lapply(names(scenarios), \(k) {
    pnl <- values[[k]]$npv - v_now$npv
    list(scenario = k, label = unname(scenarios[k]), npv = values[[k]]$npv, clean_price = values[[k]]$clean_price, pnl = pnl, pnl_error = pnl - actual_pnl)
  })
  grid_now <- cnn_zero_grid(curve_now, d_now)
  list(
    inputs = list(month = month, bond = b),
    dates = list(origin = format(d_now), next_month = format(d_next)),
    nodes = list(tenor = CNN_TENORS, current = y_now, scenario = scenario_yield, change_bp = change),
    curves = list(years = grid_now$years, current = grid_now$yield_pct,
                  scenario = lapply(names(scenarios), \(k) cnn_zero_grid(curves[[k]], d_next)$yield_pct) |> stats::setNames(names(scenarios))),
    current_value = list(npv = v_now$npv, clean_price = v_now$clean_price),
    valuation = valuation,
    conventions = list(
      curve = "各年限（2・5・10・20 年）の利回りを割引係数 (1+y)^-t にし、単調な対数3次補間の割引カーブを通す。4 本のカーブは同じ作り方",
      bond = sprintf("額面 %s、クーポン %.2f%%（半年ごと）、当月末に発行、残存 %d 年の固定利付債。現在の価値は当月末のカーブ、翌月の価値は翌月末の各カーブで評価", format(b$faceAmount, big.mark = ","), b$couponPct, as.integer(b$remainingYears)),
      pnl = "損益 = 翌月末の価値 − 当月末の価値（利息と 1 か月の経過を含む）",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}
