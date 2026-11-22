# Chapter 14: states that cannot be reduced to a ratio, carried path by path. MBS: the balance and the prepayment speed of a
# pool along a path of refinancing rates, and the price and the option-adjusted spread (OAS) over Hull-White paths
# (create_mbs_pass_through, compute_mbs_cashflows, compute_mbs_path_values, compute_mbs_oas, generate_hull_white_monthly_rates).
# PRDC: a target redemption (TARN) and a knock-out, with the cumulative coupon and the survival as the state
# (compute_prdc_three_factor_value). Needs lookback_model.R (the checks and the limits' error). All inputs are synthetic.
#
# POST /api/mbs/state
#   {"pool": {"balance": 100, "mortgageRatePct": 5, "passThroughRatePct": 4.5, "months": 360, "psaPct": 100, "incentive": 20, "refiCostPct": 0.5},
#    "refinanceStartPct": 4, "slopePct": 0.5,
#    "mc": {"paths": 100, "seed": 48, "meanReversion": 0.15, "volatilityPct": 1.2, "flatRatePct": 2, "spreadPct": 3, "assumedPrice": 105}}
# POST /api/prdc/tarn
#   {"note": {"years": 5, "spot": 150, "fxVolPct": 11, "domesticPct": 1, "foreignPct": 4, "fxBase": 150, "leveragePct": 80,
#             "subtractionPct": 78, "floorPct": 0, "capPct": 8, "notional": 100},
#    "tarn": {"targetPct": 15, "targetCoupon": "capped", "makeWhole": true, "knockOutLevel": 200},
#    "mc": {"paths": 5000, "stepsPerYear": 12, "seed": 7}}
# GET /api/mbs-prdc/summary   the precomputed results (server/data/p14/*.json)
# A limit of the table in docs/part3_chapters_13_15_spec.md (7) exceeded is HTTP 400 with a message in Japanese.

# Each keeps a call under 0.3 s on the development PC; the work of the TARN is paths x steps a year x years (docs, 7).
P14_LIMITS <- list(
  mbs = list(months = c(12L, 360L), paths = c(2L, 200L)),
  tarn = list(years = c(2L, 10L), paths = c(200L, 20000L), steps_per_year = c(1L, 12L), work = 300000L)
)
P14_DATA_DIR <- file.path(script_dir, "data", "p14")
P14_FILES <- c(mbs_oas_convergence = "mbs_oas_convergence.json", prdc_tarn_distribution = "prdc_tarn_distribution.json")

p14_object <- function(x, label) {
  if (is.null(x)) return(list())
  if (!is.list(x) || is.data.frame(x)) p16_bad(sprintf("%s は JSON のオブジェクトにしてください", label))
  x
}

# The refinancing rate along a path: a start and a slope a year, between 0.25% and 15%.
p14_refinance_path <- function(start, slope, months) pmin(pmax(start + slope * seq_len(months) / 12, 0.0025), 0.15)

mbs_state_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("pool", "refinanceStartPct", "slopePct", "mc"))
  lim <- P14_LIMITS$mbs
  pl <- p14_object(body$pool, "pool"); p16_unknown(pl, c("balance", "mortgageRatePct", "passThroughRatePct", "months", "psaPct", "incentive", "refiCostPct"), "pool.")
  mc <- p14_object(body$mc, "mc"); p16_unknown(mc, c("paths", "seed", "meanReversion", "volatilityPct", "flatRatePct", "spreadPct", "assumedPrice"), "mc.")
  balance <- p16_num(pl$balance, "元本", 1, 1e9, 100)
  mortgage <- p16_num(pl$mortgageRatePct, "住宅ローン金利（%）", 0.1, 20, 5) / 100
  pass_through <- p16_num(pl$passThroughRatePct, "パススルー金利（%）", 0, mortgage * 100, 4.5) / 100
  months <- p16_num(pl$months, "返済月数", lim$months[1], lim$months[2], 360, whole = TRUE)
  psa <- p16_num(pl$psaPct, "PSA（%）", 0, 1000, 100) / 100
  incentive <- p16_num(pl$incentive, "借換えへの感応度", 0, 100, 20)
  refi_cost <- p16_num(pl$refiCostPct, "借換え費用（%）", 0, 5, 0.5) / 100
  start <- p16_num(body$refinanceStartPct, "借換え金利の開始値（%）", 0.25, 15, 4) / 100
  slope <- p16_num(body$slopePct, "借換え金利の変化（%/年）", 0, 3, 0.5) / 100
  paths <- p16_num(mc$paths, "経路数", lim$paths[1], lim$paths[2], 100, whole = TRUE)
  if (paths %% 2L != 0L) p16_bad("経路数は偶数にしてください（対称変量の経路を対にして使います）")
  seed <- p16_num(mc$seed, "乱数の種", 1, 2147483647, 48, whole = TRUE)
  reversion <- p16_num(mc$meanReversion, "平均回帰の速さ", 0.001, 5, 0.15)
  volatility <- p16_num(mc$volatilityPct, "短期金利のボラティリティ（%）", 0.01, 10, 1.2) / 100
  flat <- p16_num(mc$flatRatePct, "短期金利の水準（%）", -2, 15, 2) / 100
  spread <- p16_num(mc$spreadPct, "借換え金利 − 短期金利（%）", -2, 10, 3) / 100
  assumed <- p16_num(mc$assumedPrice, "OAS を求める価格", 1, 1000, 105)

  pool <- p16_rmql(rmql::create_mbs_pass_through(balance, mortgage, pass_through, as.integer(months), psa, incentive, refi_cost))
  scenarios <- list(down = -slope, flat = 0, up = slope)
  by_scenario <- lapply(names(scenarios), function(k) {
    f <- p14_refinance_path(start, scenarios[[k]], months)
    cf <- p16_rmql(rmql::compute_mbs_cashflows(pool, f))
    value <- p16_rmql(rmql::compute_mbs_path_values(pool, matrix(pmax(f - spread, -0.02), 1L), matrix(f, 1L)))
    list(name = k, slope_pct_per_year = 100 * scenarios[[k]], refinance_rate = f, balance = cf$begin_balance, end_balance = cf$end_balance, cpr = cf$cpr,
         prepaid = cf$prepaid_principal, cashflow = cf$cashflow, price = value$price, weighted_average_life = value$weighted_average_life)
  })
  names(by_scenario) <- names(scenarios)

  rates <- p16_rmql(rmql::generate_hull_white_monthly_rates(as.integer(paths), as.integer(months), flat, reversion, volatility, seed = seed))
  refi <- pmax(rates + spread, 0)
  values <- p16_rmql(rmql::compute_mbs_path_values(pool, rates, refi))
  oas <- p16_rmql(rmql::compute_mbs_oas(pool, assumed, rates, refi))
  order_by_price <- order(values$price)
  pick <- unique(order_by_price[c(1L, ceiling(length(order_by_price) / 2), length(order_by_price))])
  sample_paths <- lapply(pick, function(i) {
    cf <- p16_rmql(rmql::compute_mbs_cashflows(pool, refi[i, ]))
    list(path = i, price = values$price[i], short_rate = rates[i, ], balance = cf$begin_balance, cpr = cf$cpr)
  })
  list(
    inputs = list(pool = list(balance = balance, mortgageRatePct = 100 * mortgage, passThroughRatePct = 100 * pass_through, months = months, psaPct = 100 * psa, incentive = incentive, refiCostPct = 100 * refi_cost),
                  refinanceStartPct = 100 * start, slopePct = 100 * slope,
                  mc = list(paths = paths, seed = seed, meanReversion = reversion, volatilityPct = 100 * volatility, flatRatePct = 100 * flat, spreadPct = 100 * spread, assumedPrice = assumed)),
    months = seq_len(months),
    scenarios = by_scenario,
    monte_carlo = list(price = mean(values$price), standard_error = stats::sd(values$price) / sqrt(paths), weighted_average_life = mean(values$weighted_average_life),
                       prices = values$price, oas = oas, oas_bp = 1e4 * oas, assumed_price = assumed, sample_paths = sample_paths),
    limits = lim,
    conventions = list(
      prepayment = "月ごとの期限前返済率 CPR = min(上限, PSA × min(0.002 m, 0.06) × exp(感応度 × (住宅ローン金利 − 借換え金利 − 借換え費用)))、SMM = 1 − (1 − CPR)^(1/12)",
      discount = "m か月目のキャッシュフローは exp(−Σ (短期金利 + OAS)/12) で割り引く。価格は経路の平均",
      scenario = "借換え金利は、開始値から一定の傾きで動く（下限 0.25%、上限 15%）。短期金利は、借換え金利から借換え金利 − 短期金利 の差を引いたもの",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

prdc_tarn_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("note", "tarn", "mc"))
  lim <- P14_LIMITS$tarn
  nt <- p14_object(body$note, "note"); p16_unknown(nt, c("years", "spot", "fxVolPct", "domesticPct", "foreignPct", "fxBase", "leveragePct", "subtractionPct", "floorPct", "capPct", "notional"), "note.")
  tr <- p14_object(body$tarn, "tarn"); p16_unknown(tr, c("targetPct", "targetCoupon", "makeWhole", "knockOutLevel"), "tarn.")
  mc <- p14_object(body$mc, "mc"); p16_unknown(mc, c("paths", "stepsPerYear", "seed"), "mc.")
  years <- p16_num(nt$years, "年数", lim$years[1], lim$years[2], 5, whole = TRUE)
  spot <- p16_num(nt$spot, "為替の現物", 1e-6, 1e6, 150)
  fx_vol <- p16_num(nt$fxVolPct, "為替のボラティリティ（%）", 1, 100, 11) / 100
  domestic <- p16_num(nt$domesticPct, "円の金利（%）", -2, 15, 1) / 100
  foreign <- p16_num(nt$foreignPct, "外貨の金利（%）", -2, 25, 4) / 100
  fx_base <- p16_num(nt$fxBase, "基準の為替", 1e-6, 1e6, 150)
  leverage <- p16_num(nt$leveragePct, "レバレッジ（%）", 0, 1000, 80) / 100
  subtraction <- p16_num(nt$subtractionPct, "控除（%）", -100, 1000, 78) / 100
  floor_rate <- p16_num(nt$floorPct, "フロア（%）", 0, 100, 0) / 100
  cap_rate <- p16_num(nt$capPct, "キャップ（%）", floor_rate * 100, 100, 8) / 100
  notional <- p16_num(nt$notional, "想定元本", 1, 1e12, 100)
  target <- if (is.null(tr$targetPct)) Inf else p16_num(tr$targetPct, "目標（%）", 0.1, 1000, NULL) / 100
  target_coupon <- p16_choice(tr$targetCoupon, "targetCoupon", c("capped", "full"), "capped")
  make_whole <- if (is.null(tr$makeWhole)) FALSE else tr$makeWhole
  if (!(is.logical(make_whole) && length(make_whole) == 1L && !is.na(make_whole))) p16_bad("makeWhole は true か false にしてください")
  if (make_whole && !is.finite(target)) p16_bad("目標までに足りない分を最後に払う（makeWhole）には、目標が必要です")
  knock_out <- if (is.null(tr$knockOutLevel)) Inf else p16_num(tr$knockOutLevel, "ノックアウトの為替水準", 1e-6, 1e6, NULL)
  paths <- p16_num(mc$paths, "経路数", lim$paths[1], lim$paths[2], 5000, whole = TRUE)
  steps <- p16_num(mc$stepsPerYear, "1 年あたりのステップ数", lim$steps_per_year[1], lim$steps_per_year[2], 12, whole = TRUE)
  seed <- p16_num(mc$seed, "乱数の種", 1, 2147483647, 7, whole = TRUE)
  if (paths * steps * years > lim$work) p16_bad(sprintf("経路数 × ステップ数/年 × 年数 は %s 以下にしてください（%s × %d × %d = %s）", p16_fmt(lim$work), p16_fmt(paths), as.integer(steps), as.integer(years), p16_fmt(paths * steps * years)))

  today <- as.Date(P16_SETTLEMENT)
  dom_curve <- rmql::create_flat_curve(today, domestic, "actual_365_fixed", "continuous", index = "tonar")
  for_curve <- rmql::create_flat_curve(today, foreign, "actual_365_fixed", "continuous", index = "sofr")
  times <- seq_len(years)
  result <- p16_rmql(rmql::compute_prdc_three_factor_value(
    spot, fx_vol, dom_curve, for_curve, c(0.03, 0.01), c(0.05, 0.012), c(0.3, -0.2, 0.4), times, rep(1, years), fx_base, leverage, subtraction,
    floor_rate, cap_rate, notional = notional, paths = as.integer(paths), steps_per_year = as.integer(steps), seed = seed,
    target = target, target_coupon = target_coupon, make_whole = make_whole, knock_out_level = knock_out))
  s <- result$summary
  has_state <- is.finite(target) || is.finite(knock_out)
  endings <- NULL
  if (has_state) {
    e <- result$endings
    ended <- e$target_probability + e$knock_out_probability
    endings <- list(times = e$time, target_probability = e$target_probability, knock_out_probability = e$knock_out_probability, alive = 1 - cumsum(ended))
  }
  coupon_at <- function(fx) pmin(cap_rate, pmax(leverage * fx / fx_base - subtraction, floor_rate))
  list(
    inputs = list(note = list(years = years, spot = spot, fxVolPct = 100 * fx_vol, domesticPct = 100 * domestic, foreignPct = 100 * foreign, fxBase = fx_base, leveragePct = 100 * leverage,
                              subtractionPct = 100 * subtraction, floorPct = 100 * floor_rate, capPct = 100 * cap_rate, notional = notional),
                  tarn = list(targetPct = if (is.finite(target)) 100 * target else NULL, targetCoupon = target_coupon, makeWhole = make_whole, knockOutLevel = if (is.finite(knock_out)) knock_out else NULL),
                  mc = list(paths = paths, stepsPerYear = steps, seed = seed)),
    summary = list(value = s$value, standard_error = s$standard_error, analytic = s$analytic, plain_value = if (has_state) s$plain_value else s$value,
                   expected_life = if (has_state) s$expected_life else years),
    endings = endings,
    coupon_curve = list(fx = seq(0.5, 1.5, length.out = 21) * fx_base, coupon = coupon_at(seq(0.5, 1.5, length.out = 21) * fx_base)),
    limits = lim,
    conventions = list(
      state = "状態は、累積クーポンと、生きているか。クーポンは各日に、レバレッジ × 為替 / 基準 − 控除 を、フロアとキャップで切り取る",
      target = "累積クーポンが目標に達した日に償還される。capped は、その日のクーポンを目標に届くまでに切り、full は全額払う。makeWhole は、満期まで達しなければ不足分を最後に払う",
      model = "為替と、円・外貨の Hull–White 短期金利の 3 因子（相関 0.3、−0.2、0.4）。割引は円のカーブ",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

mbs_prdc_summary <- function() {
  files <- file.path(P14_DATA_DIR, P14_FILES)
  missing <- !file.exists(files)
  if (any(missing)) stop("事前計算の結果がありません：", paste(P14_FILES[missing], collapse = "、"),
                         "。Rscript server/scripts/p14/<名前>.R で作ってください。", call. = FALSE)
  out <- lapply(files, \(f) jsonlite::fromJSON(f, simplifyVector = FALSE))
  names(out) <- names(P14_FILES)
  out$limits <- P14_LIMITS
  out$engine <- paste("rmql", as.character(utils::packageVersion("rmql")))
  out
}
