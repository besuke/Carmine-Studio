# OIS asset swap offer sheet for the Carmine-Studio API. All calculations are rmql.
# Inputs: Curie's demo (fictitious) offers, bond attributes and OIS quotes, copied into server/data/asw_demo.
#
# Conventions follow Curie's A1 demo (reconciled in server/tests/reconciliation/asw/): OIS curves MonotonicLogCubic,
# annual, payment lag 0, no extrapolation; the ASW overnight leg semiannual, lag 0 (a demo assumption in
# Curie); the swap starts on the bond's settlement date; spread day count = the index's.
#
# ASW (Coral-Book docs/asw_offer_sheet_spec.qmd): with dirty price P_d, U = N (P_d/100 - 1),
#   s* = (B - L - R - U D(t,S)) / A
# B bond cash flows after S, L the overnight leg, R the principal at the last overnight payment, A the spread annuity.

suppressPackageStartupMessages(library(rmql))

# server.R defines script_dir (the server folder); the data can also be pointed to with LFL_ASW_DATA.
ASW_DATA_DIR <- Sys.getenv("LFL_ASW_DATA", file.path(if (exists("script_dir")) script_dir else "server", "data", "asw_demo"))

asw_read_csv <- function(name) {
  utils::read.csv(file.path(ASW_DATA_DIR, name), stringsAsFactors = FALSE, encoding = "UTF-8", na.strings = c("", "NA"))
}

ASW_CURRENCIES <- list(
  JPY = list(index = "tonar", settlement_days = 2L, day_count = "actual_365_fixed", index_name = "TONAR"),
  USD = list(index = "sofr", settlement_days = 2L, day_count = "actual_360", index_name = "SOFR", basis_leg = "USD SOFR flat"),
  EUR = list(index = "estr", settlement_days = 2L, day_count = "actual_360", index_name = "€STR", basis_leg = "EUR ESTR flat")
)
ASW_CALENDARS <- c(Japan = "japan", UnitedStates_GovernmentBond = "us_government_bond", TARGET = "target")
ASW_DAY_COUNTS <- c(Actual365Fixed = "actual_365_fixed", Thirty360_BondBasis = "thirty_360_bond_basis", ActualActual_Bond = "act_act_isma")
ASW_FREQ_TENOR <- c(`1` = "12M", `2` = "6M", `4` = "3M", `12` = "1M")
ASW_SETTINGS <- list(asw_payment_frequency = 2L, asw_payment_lag = 0L, curve_interpolation = "monotonic_log_cubic",
                     curve_payment_frequency = 1L, curve_payment_lag = 0L, extrapolation = FALSE)

ASW_DATA <- local({
  offers <- asw_read_csv("offers.csv")
  offers$offer_date <- as.Date(offers$offer_date)
  offers$offer_settlementdate <- as.Date(offers$offer_settlementdate)
  attributes <- asw_read_csv("attributes.csv")
  for (col in c("issue_date", "maturity_date", "first_call_date", "attribute_date")) attributes[[col]] <- as.Date(attributes[[col]])
  ois <- lapply(stats::setNames(names(ASW_CURRENCIES), names(ASW_CURRENCIES)), function(ccy) {
    q <- utils::read.delim(file.path(ASW_DATA_DIR, paste0("ois_", ccy, ".txt")), sep = "|", encoding = "UTF-8", stringsAsFactors = FALSE)
    q$marketdate <- as.Date(q$marketdate)
    q
  })
  read_pipe <- function(name) utils::read.delim(file.path(ASW_DATA_DIR, name), sep = "|", encoding = "UTF-8", stringsAsFactors = FALSE)
  fx <- read_pipe("fx.txt")
  fx$marketdate <- as.Date(fx$marketdate)
  fx$spot_date <- as.Date(fx$spot_date)
  basis <- read_pipe("basis.txt")
  basis$marketdate <- as.Date(basis$marketdate)
  basis$maturity_date <- as.Date(basis$maturity_date)
  list(offers = offers, attributes = attributes, ois = ois, fx = fx, basis = basis)
})

# The cross-currency swap the yen-converted ASW assumes (Curie basis_terms_for_model_Curie): pay the foreign
# overnight rate flat, receive TONAR + basis, constant notional, JPY collateral. Only quotes on these terms are used.
asw_basis_terms <- function(ccy) {
  list(spread_leg = "JPY", pay_leg = ASW_CURRENCIES[[ccy]]$basis_leg, receive_leg = "JPY TONAR + basis_bp",
       notional_type = "constant", collateral_currency = "JPY")
}

# Quotes on the same pair, market date, terms and maturity are averaged; the averages are interpolated by a
# natural cubic spline in years from the valuation date (Actual/365), without extrapolation (Curie
# spline_by_maturity_Curie). This interpolates the quotes; it is not a bootstrap of a cross-currency curve.
asw_basis_points <- function(ccy) {
  t <- asw_basis_terms(ccy)
  b <- ASW_DATA$basis
  keep <- b$marketdate == ASW_VALUATION_DATE & b$currency_pair == paste0(ccy, "JPY") & b$spread_leg == t$spread_leg &
    b$pay_leg == t$pay_leg & b$receive_leg == t$receive_leg & b$notional_type == t$notional_type &
    b$collateral_currency == t$collateral_currency
  b <- b[keep, ]
  m <- sort(unique(b$maturity_date))
  data.frame(maturity_date = m,
             basis_bp = vapply(m, function(d) mean(b$basis_bp[b$maturity_date == d]), 0),
             n_quotes = vapply(m, function(d) sum(b$maturity_date == d), 0L),
             time = as.numeric(m - ASW_VALUATION_DATE) / 365)
}

asw_interpolate_basis <- function(ccy, maturity) {
  p <- asw_basis_points(ccy)
  if (nrow(p) < 2L) return(list(value = NA_real_, points = p, message = paste0(ccy, "JPY のベーシス気配が2点未満のため補間できない")))
  x0 <- as.numeric(as.Date(maturity) - ASW_VALUATION_DATE) / 365
  if (x0 < min(p$time) || x0 > max(p$time)) {
    return(list(value = NA_real_, points = p, message = paste0("満期 ", maturity, " がベーシス気配の範囲（", min(p$maturity_date),
                                                              "〜", max(p$maturity_date), "）の外。外挿しない")))
  }
  f <- stats::splinefun(p$time, p$basis_bp, method = "natural")
  list(value = f(x0), message = "", points = p, spline = f)
}

ASW_VALUATION_DATE <- as.Date("2026-10-06")

# One curve per currency on the valuation date; a failure is kept with its reason.
ASW_CURVES <- lapply(stats::setNames(names(ASW_CURRENCIES), names(ASW_CURRENCIES)), function(ccy) {
  spec <- ASW_CURRENCIES[[ccy]]
  q <- ASW_DATA$ois[[ccy]]
  q <- q[q$marketdate == ASW_VALUATION_DATE & q$instrument_type == "spot_ois", ]
  if (!nrow(q)) return(list(error = paste0(ccy, " の評価日のOIS気配がない")))
  tryCatch({
    instruments <- rmql::create_ois_instruments(q$tenor, q$rate_pct / 100, spec$settlement_days,
                                                          ASW_SETTINGS$curve_payment_frequency, ASW_SETTINGS$curve_payment_lag)
    curve <- rmql::bootstrap_ois_curve(ASW_VALUATION_DATE, ASW_VALUATION_DATE, spec$index, spec$day_count, instruments,
                                                 interpolation = ASW_SETTINGS$curve_interpolation)
    rep <- rmql::get_quote_repricing(curve)
    list(curve = curve, quotes = q, repricing = rep, last_date = max(rep$pillar_date), quote_time = unique(q$quote_time)[1],
         source = unique(q$source)[1])
  }, error = function(e) list(error = conditionMessage(e)))
})

# Join each offer with the attributes of the same ISIN on the offer date (Curie's "exact" policy), and check
# what the model supports. Returns the reason the offer cannot be computed, or "" .
asw_offer_rows <- function() {
  o <- ASW_DATA$offers
  a <- ASW_DATA$attributes
  lapply(seq_len(nrow(o)), function(i) {
    offer <- as.list(o[i, ])
    hit <- a[a$ISIN == offer$ISIN & a$attribute_date == offer$offer_date, ]
    attr <- if (nrow(hit) == 1L) as.list(hit[1, ]) else NULL
    reason <- if (nrow(hit) == 0L) {
      "銘柄属性がない（同じISIN・オファー日の属性が見つからない）"
    } else if (nrow(hit) > 1L) {
      "銘柄属性が一つに定まらない"
    } else if (!identical(attr$coupon_type, "FIXED")) {
      paste0("未対応：変動利付等（coupon_type = ", attr$coupon_type, "）。固定利付債として代用しない")
    } else if (!is.na(attr$first_call_date)) {
      paste0("未対応：期限前償還条項あり（First Call日 ", attr$first_call_date, "）。オプション価値は扱わない")
    } else if (!isTRUE(attr$redemption == 100)) {
      "未対応：償還額が100ではない"
    } else if (is.null(ASW_CURRENCIES[[attr$currency]])) {
      paste0("未対応の通貨：", attr$currency)
    } else if (!is.null(ASW_CURVES[[attr$currency]]$error)) {
      paste0(attr$currency, " のOISカーブを構築できない：", ASW_CURVES[[attr$currency]]$error)
    } else if (is.na(ASW_CALENDARS[attr$calendar]) || is.na(ASW_DAY_COUNTS[attr$day_count]) ||
               is.na(ASW_FREQ_TENOR[as.character(attr$coupon_frequency)])) {
      "未対応の規約（カレンダー・日数計算・利払回数）"
    } else if (attr$maturity_date > ASW_CURVES[[attr$currency]]$last_date) {
      paste0("満期 ", attr$maturity_date, " がカーブの最後のピラー ", ASW_CURVES[[attr$currency]]$last_date, " より後（外挿しない）")
    } else {
      ""
    }
    list(offer = offer, attr = attr, reason = reason)
  })
}

asw_bond <- function(attr) {
  rmql::create_fixed_rate_bond(
    settlement_days = as.integer(attr$settlement_days), face_amount = 100,
    effective_date = attr$issue_date, termination_date = attr$maturity_date,
    tenor = ASW_FREQ_TENOR[[as.character(attr$coupon_frequency)]], calendar = ASW_CALENDARS[[attr$calendar]],
    convention = tolower(attr$schedule_convention), termination_convention = tolower(attr$maturity_convention),
    rule = tolower(attr$date_generation), end_of_month = isTRUE(as.logical(attr$end_of_month)),
    coupon_rate = attr$coupon_rate, day_count = ASW_DAY_COUNTS[[attr$day_count]],
    payment_convention = tolower(attr$payment_convention), redemption = attr$redemption
  )
}

iso <- function(d) format(as.Date(d), "%Y-%m-%d")

# The ASW of one supported offer. detail = TRUE adds cash flows, the curve and the checks.
asw_price <- function(row, detail = FALSE) {
  attr <- row$attr
  offer <- row$offer
  cv <- ASW_CURVES[[attr$currency]]
  bond <- asw_bond(attr)
  settle <- rmql::compute_settlement_date(bond, ASW_VALUATION_DATE)
  if (settle != offer$offer_settlementdate) {
    return(list(error = paste0("受渡日の不一致：債券の受渡日 ", settle, "（評価日＋", attr$settlement_days,
                               "営業日）とオファー受渡日 ", offer$offer_settlementdate, " が異なる")))
  }
  v <- rmql::compute_ois_asset_swap(bond, offer$offer_price, cv$curve, ASW_VALUATION_DATE,
                                              payment_frequency = ASW_SETTINGS$asw_payment_frequency,
                                              payment_lag = ASW_SETTINGS$asw_payment_lag, on_error = "na")
  if (!is.na(v$error)) return(list(error = paste("計算エラー：", v$error)))
  summary <- list(
    accrued = v$accrued, dirty_price = v$dirty_price, fair_spread_bp = v$fair_spread_bp,
    effective_date = iso(v$effective_date), maturity_date = iso(v$maturity_date), settlement_date = iso(settle)
  )
  yen <- tryCatch(asw_yen(attr, offer, bond, v, detail),
                  error = function(e) list(status = "not_computed", reason = paste("円換算ASWの計算エラー：", conditionMessage(e))))
  if (!detail) return(list(summary = summary, yen = yen))

  curve <- cv$curve
  N <- 100
  # Bond cash flows after the start of the swap, as the ASW pays them
  bcf <- rmql::get_bond_cashflows(bond)
  bcf <- bcf[bcf$payment_date > v$effective_date, ]
  bcf_df <- rmql::compute_discount(curve, bcf$payment_date)
  # The overnight leg and the spread annuity: an OIS from the start to the maturity, semiannual, lag 0,
  # fixed rate 1 so that its fixed amounts are N * tau (the annuity units).
  swap <- rmql::create_ois_swap("receiver", N, v$effective_date, v$maturity_date, ASW_CURRENCIES[[attr$currency]]$index, 1,
                                          fixed_frequency = ASW_SETTINGS$asw_payment_frequency,
                                          overnight_frequency = ASW_SETTINGS$asw_payment_frequency,
                                          payment_lag = ASW_SETTINGS$asw_payment_lag)
  scf <- rmql::compute_ois_swap_cashflows(swap, curve, ASW_VALUATION_DATE)
  on <- scf[scf$leg == "overnight", ]
  fx <- scf[scf$leg == "fixed", ]
  on_df <- rmql::compute_discount(curve, on$payment_date)
  fx_df <- rmql::compute_discount(curve, fx$payment_date)
  start_df <- rmql::compute_discount(curve, v$effective_date)
  last_pay <- max(on$payment_date)
  upfront <- N * (v$dirty_price / 100 - 1)
  # Components rebuilt from the cash flows; they must agree with compute_ois_asset_swap
  parts <- list(
    bond_pv = sum(bcf$amount * bcf_df), overnight_pv = sum(on$amount * on_df), annuity = sum(fx$amount * fx_df),
    principal_pv = N * rmql::compute_discount(curve, last_pay), upfront_pv = upfront * start_df
  )
  rebuilt_spread <- (parts$bond_pv - parts$overnight_pv - parts$principal_pv - parts$upfront_pv) / parts$annuity
  # Curve for the chart: weekly dates from the valuation date to the bond's maturity (+ the pillars)
  rep <- cv$repricing
  dates <- sort(unique(c(seq(ASW_VALUATION_DATE, as.Date(v$maturity_date) + 30L, by = "1 week"), rep$pillar_date)))
  dates <- dates[dates <= cv$last_date]
  zero <- rmql::compute_zero_rate(curve, dates, "actual_365_fixed", "continuous")
  zero[dates == ASW_VALUATION_DATE] <- NA_real_
  spec <- ASW_CURRENCIES[[attr$currency]]
  list(summary = summary, yen = yen, detail = list(
    curve = list(
      currency = attr$currency, index = spec$index_name, day_count = spec$day_count, settlement_days = spec$settlement_days,
      interpolation = ASW_SETTINGS$curve_interpolation, payment_frequency = ASW_SETTINGS$curve_payment_frequency,
      payment_lag = ASW_SETTINGS$curve_payment_lag, extrapolation = ASW_SETTINGS$extrapolation,
      marketdate = iso(ASW_VALUATION_DATE), quote_time = cv$quote_time, source = cv$source,
      quotes = data.frame(tenor = rep$tenor, rate = rep$rate, start_date = iso(rep$start_date), pillar_date = iso(rep$pillar_date),
                          implied_rate = rep$implied_rate, reproduction_error = rep$reproduction_error),
      points = data.frame(date = iso(dates), time = as.numeric(dates - ASW_VALUATION_DATE) / 365,
                          discount = rmql::compute_discount(curve, dates), zero_continuous = zero)
    ),
    price = list(
      clean_price = offer$offer_price, accrued = v$accrued, dirty_price = v$dirty_price, upfront = upfront,
      upfront_discount = start_df, upfront_pv = v$upfront_pv, settlement_date = iso(settle),
      accrual_day_count = attr$day_count
    ),
    bond_cashflows = data.frame(payment_date = iso(bcf$payment_date), kind = bcf$kind,
                                accrual_start = ifelse(is.na(bcf$accrual_start), NA, iso(bcf$accrual_start)),
                                accrual_end = ifelse(is.na(bcf$accrual_end), NA, iso(bcf$accrual_end)),
                                amount = bcf$amount, discount = bcf_df, pv = bcf$amount * bcf_df),
    overnight_cashflows = data.frame(accrual_start = iso(on$accrual_start), accrual_end = iso(on$accrual_end),
                                     payment_date = iso(on$payment_date), amount = on$amount, spread_unit = fx$amount,
                                     discount = on_df, pv = on$amount * on_df, spread_unit_pv = fx$amount * fx_df),
    principal = list(payment_date = iso(last_pay), amount = N, discount = rmql::compute_discount(curve, last_pay)),
    components = list(
      notional = N, bond_pv = parts$bond_pv, overnight_pv = parts$overnight_pv, principal_pv = parts$principal_pv,
      upfront_pv = parts$upfront_pv, annuity = parts$annuity, fair_spread_bp = v$fair_spread_bp,
      engine = list(bond_leg_pv = v$bond_leg_pv, overnight_leg_pv = v$overnight_leg_pv, principal_pv = v$principal_pv,
                    upfront_pv = v$upfront_pv, spread_annuity = v$spread_annuity, npv_at_zero_spread = v$npv)
    ),
    checks = list(
      rebuilt_spread_bp = rebuilt_spread * 1e4,
      rebuilt_minus_engine_bp = rebuilt_spread * 1e4 - v$fair_spread_bp,
      npv_at_fair_spread = parts$overnight_pv + parts$principal_pv + parts$upfront_pv + v$fair_spread_bp / 1e4 * parts$annuity - parts$bond_pv,
      price_sensitivity_bp_per_price = -N * start_df / 100 / parts$annuity * 1e4
    )
  ))
}

# Yen-converted ASW of a foreign bond (Coral-Book asw_offer_sheet_spec.qmd "通貨ベーシスを反映した円換算ASW";
# Curie compute_asset_swap_basis_JPY). rmql compute_yen_asset_swap computes it. With detail = TRUE the
# hedged cash flows, the calibration of z and the checks are rebuilt here from the same curves:
#   F_z(S,T) = X (D_f(T)/D_f(S)) / (D_j(T)/D_j(S)) exp(-z tau(S,T)),   Q_f(z) - Q_j - b A_j = 0,
#   s_j = (B_j - Q_j - U_j) / A_j
asw_yen <- function(attr, offer, bond, v, detail = FALSE) {
  ccy <- attr$currency
  if (identical(ccy, "JPY")) return(NULL)
  out <- list(status = "not_computed", reason = "", fx_spot = NA_real_, basis_bp = NA_real_, yen_asw_bp = NA_real_)
  fail <- function(msg) {
    out$reason <- msg
    out
  }
  jpy <- ASW_CURVES$JPY
  if (!is.null(jpy$error)) return(fail(paste0("JPY のOISカーブを構築できない：", jpy$error)))
  fx <- ASW_DATA$fx[ASW_DATA$fx$marketdate == ASW_VALUATION_DATE & ASW_DATA$fx$base_currency == ccy & ASW_DATA$fx$quote_currency == "JPY", ]
  if (nrow(fx) != 1L) return(fail(paste0("評価日の ", ccy, "JPY のFXスポットが1件に定まらない（", nrow(fx), "件）")))
  out$fx_spot <- fx$fx_spot
  if (fx$spot_date != as.Date(v$effective_date)) {
    return(fail(paste0("FXの受渡日 ", fx$spot_date, " とASW開始日 ", v$effective_date, " が異なる（FXスワップでの調整は未実装）")))
  }
  basis <- asw_interpolate_basis(ccy, attr$maturity_date)
  out$basis_bp <- basis$value
  if (is.na(basis$value)) return(fail(basis$message))
  y <- rmql::compute_yen_asset_swap(
    bond, offer$offer_price, ASW_CURVES[[ccy]]$curve, jpy$curve, fx$fx_spot, basis$value, ASW_VALUATION_DATE,
    foreign_payment_frequency = ASW_SETTINGS$asw_payment_frequency, yen_payment_frequency = ASW_SETTINGS$asw_payment_frequency,
    foreign_payment_lag = ASW_SETTINGS$asw_payment_lag, yen_payment_lag = ASW_SETTINGS$asw_payment_lag, on_error = "na"
  )
  if (!is.na(y$error)) return(fail(paste("円換算ASWの計算エラー：", y$error)))
  out <- list(
    status = "computed", reason = "", fx_spot = fx$fx_spot, basis_bp = basis$value, yen_asw_bp = y$yen_asw_bp,
    native_asw_bp = y$native_asw_bp, simple_sum_bp = y$simple_sum_bp, calibrated_discount_spread_bp = y$calibrated_discount_spread_bp,
    hedged_bond_pv_yen = y$hedged_bond_pv_yen, yen_base_leg_pv = y$yen_base_leg_pv, upfront_pv_yen = y$upfront_pv_yen,
    spread_annuity_yen = y$spread_annuity_yen, npv_yen = y$npv_yen
  )
  if (!detail) return(out)

  N <- 100
  X <- fx$fx_spot
  S <- as.Date(v$effective_date)
  fcurve <- ASW_CURVES[[ccy]]$curve
  jcurve <- jpy$curve
  z <- y$calibrated_discount_spread_bp / 1e4
  dfs <- function(curve, d) rmql::compute_discount(curve, as.Date(d))
  tau <- function(d) as.numeric(as.Date(d) - S) / 365
  fwd <- function(d) X * (dfs(fcurve, d) / dfs(fcurve, S)) / (dfs(jcurve, d) / dfs(jcurve, S)) * exp(-z * tau(d))
  bcf <- rmql::get_bond_cashflows(bond)
  bcf <- bcf[bcf$payment_date > S, ]
  F <- fwd(bcf$payment_date)
  dj <- dfs(jcurve, bcf$payment_date)
  hedged <- data.frame(payment_date = iso(bcf$payment_date), kind = bcf$kind, foreign_amount = bcf$amount, fx_forward = F,
                       yen_amount = bcf$amount * F, yen_discount = dj, yen_pv = bcf$amount * F * dj)
  # Base legs on the dates of the ASW: the foreign overnight leg + principal (foreign curve) and the TONAR leg +
  # principal (JPY curve), with the spread annuity of the yen leg; amounts per 100 of foreign face.
  base_leg <- function(index, curve) {
    sw <- rmql::create_ois_swap("receiver", N, S, as.Date(v$maturity_date), index, 1,
                                          fixed_frequency = ASW_SETTINGS$asw_payment_frequency,
                                          overnight_frequency = ASW_SETTINGS$asw_payment_frequency, payment_lag = ASW_SETTINGS$asw_payment_lag)
    cf <- rmql::compute_ois_swap_cashflows(sw, curve, ASW_VALUATION_DATE)
    on <- cf[cf$leg == "overnight", ]
    list(pay = c(on$payment_date, max(on$payment_date)), amount = c(on$amount, N), unit = cf[cf$leg == "fixed", ])
  }
  fl <- base_leg(ASW_CURRENCIES[[ccy]]$index, fcurve)
  jl <- base_leg("tonar", jcurve)
  q_f <- function(z) X * dfs(jcurve, S) * sum(fl$amount * dfs(fcurve, fl$pay) / dfs(fcurve, S) * exp(-z * tau(fl$pay)))
  q_j <- X * sum(jl$amount * dfs(jcurve, jl$pay))
  a_j <- X * sum(jl$unit$amount * dfs(jcurve, jl$unit$payment_date))
  u_j <- X * N * (v$dirty_price / 100 - 1) * dfs(jcurve, S)
  b_j <- sum(hedged$yen_pv)
  s_j <- (b_j - q_j - u_j) / a_j
  b <- basis$value / 1e4
  p <- basis$points
  grid <- seq(min(p$time), max(p$time), length.out = 120)
  out$detail <- list(
    fx = list(spot = X, spot_date = iso(fx$spot_date), quote_time = fx$quote_time, convention = fx$quote_convention, source = fx$source),
    basis = list(
      terms = asw_basis_terms(ccy), interpolated_bp = basis$value, maturity_date = iso(attr$maturity_date),
      maturity_time = tau(attr$maturity_date) + as.numeric(S - ASW_VALUATION_DATE) / 365,
      method = "同じ通貨ペア・市場日・契約条件・償還日の気配を算術平均し、評価日からの年数（Actual/365）で自然3次スプライン補間（外挿なし）。CCSカーブのブートストラップではない",
      points = data.frame(maturity_date = iso(p$maturity_date), time = p$time, basis_bp = p$basis_bp, n_quotes = p$n_quotes),
      curve = data.frame(time = grid, date = iso(ASW_VALUATION_DATE + round(grid * 365)), basis_bp = basis$spline(grid))
    ),
    hedged_cashflows = hedged,
    components = list(fx_spot = X, z_bp = y$calibrated_discount_spread_bp, hedged_bond_pv = b_j, yen_base_leg_pv = q_j,
                      upfront_pv = u_j, annuity = a_j, foreign_base_leg_pv = q_f(z), basis_annuity_pv = b * a_j, yen_asw_bp = y$yen_asw_bp),
    checks = list(
      rebuilt_yen_asw_bp = s_j * 1e4, rebuilt_minus_engine_bp = s_j * 1e4 - y$yen_asw_bp,
      hedged_bond_pv_minus_engine = b_j - y$hedged_bond_pv_yen, yen_base_leg_pv_minus_engine = q_j - y$yen_base_leg_pv,
      ccs_residual_yen = q_f(z) - q_j - b * a_j,
      npv_at_fair_spread_yen = q_j + u_j + y$yen_asw_bp / 1e4 * a_j - b_j
    )
  )
  out
}

asw_conditions <- function() {
  list(
    valuation_date = iso(ASW_VALUATION_DATE),
    asw_definition = "債券CFを支払い、翌日物（日次複利）＋スプレッドを受け取る。受渡日にダーティ価格と100の差を授受（par-par）",
    asw_overnight_leg = list(payment_frequency = ASW_SETTINGS$asw_payment_frequency, payment_lag = ASW_SETTINGS$asw_payment_lag,
                             note = "半年払い・支払ラグ0は Curie のデモの仮定（実取引の条件は未確定）"),
    curve = list(interpolation = ASW_SETTINGS$curve_interpolation, payment_frequency = ASW_SETTINGS$curve_payment_frequency,
                 payment_lag = ASW_SETTINGS$curve_payment_lag, extrapolation = ASW_SETTINGS$extrapolation),
    attribute_policy = "exact（オファー日と同じ日の属性だけを使う）",
    data_note = "Curie のデモデータ（架空）。実在の銘柄・市場価格ではない",
    yen_asw = list(
      collateral = "円担保。元本は一定で、開始日と満期日に交換（MtMリセットなし）",
      ccs = "外貨の翌日物フラットを支払い、円TONAR＋ベーシスを受け取る。ベーシスは円レッグに加算",
      calibration = "満期に対応するベーシス1点（気配の補間値）で、外貨割引の一定スプレッド z を校正する。CCSの期間構造全体の校正ではない",
      fx = "FXスポットは ASW 開始日に交換するレート。FXの受渡日と開始日が違う行は計算しない",
      not_included = "取引費用、売買の気配差、MtMリセット付きCCS、クオント調整、信用・資本・資金調達の調整"
    ),
    engine = paste("rmql", as.character(utils::packageVersion("rmql")))
  )
}

# GET /api/asw/offers
asw_list <- function() {
  rows <- asw_offer_rows()
  items <- lapply(rows, function(r) {
    o <- r$offer
    a <- r$attr
    res <- if (nzchar(r$reason)) list(error = r$reason) else tryCatch(asw_price(r), error = function(e) list(error = paste("計算エラー：", conditionMessage(e))))
    list(
      offer_id = o$offer_id, book = o$offer_book, ISIN = o$ISIN,
      security_name = if (is.null(a)) o$offer_security_name else a$security_name,
      currency = if (is.null(a)) o$offer_currency else a$currency,
      coupon_rate = if (is.null(a)) NA else a$coupon_rate, maturity_date = if (is.null(a)) NA else iso(a$maturity_date),
      broker = o$broker_names, offer_price = o$offer_price, offer_size = o$offer_size, offer_size_unit = o$offer_size_unit,
      offer_date = iso(o$offer_date), settlement_date = iso(o$offer_settlementdate),
      status = if (!is.null(res$error)) (if (startsWith(res$error, "未対応")) "unsupported" else "failed") else "computed",
      reason = if (is.null(res$error)) "" else res$error,
      fair_spread_bp = if (is.null(res$summary)) NA else res$summary$fair_spread_bp,
      accrued = if (is.null(res$summary)) NA else res$summary$accrued,
      dirty_price = if (is.null(res$summary)) NA else res$summary$dirty_price,
      yen_status = if (!is.null(res$yen)) res$yen$status else if (identical(a$currency, "JPY")) "not_applicable" else "not_computed",
      yen_reason = if (is.null(res$yen)) "" else res$yen$reason,
      yen_asw_bp = if (is.null(res$yen$yen_asw_bp)) NA else res$yen$yen_asw_bp,
      basis_bp = if (is.null(res$yen$basis_bp)) NA else res$yen$basis_bp,
      fx_spot = if (is.null(res$yen$fx_spot)) NA else res$yen$fx_spot,
      simple_sum_bp = if (is.null(res$yen$simple_sum_bp)) NA else res$yen$simple_sum_bp,
      jgb_spread_bp = if (is.null(res$error) && identical(a$currency, "JPY")) asw_jgb_spread(a, o)$jgb_spread_bp %||% NA else NA,
      validation_issues = I(ASW_VALIDATION[[o$offer_id]]) # I(): always a JSON array
    )
  })
  list(conditions = asw_conditions(), offers = items)
}

# GET /api/asw/offers/<id>
asw_detail <- function(offer_id) {
  rows <- asw_offer_rows()
  hit <- Filter(function(r) identical(r$offer$offer_id, offer_id), rows)
  if (!length(hit)) return(NULL)
  r <- hit[[1]]
  res <- if (nzchar(r$reason)) list(error = r$reason) else tryCatch(asw_price(r, detail = TRUE), error = function(e) list(error = paste("計算エラー：", conditionMessage(e))))
  offer <- r$offer
  offer$offer_date <- iso(offer$offer_date)
  offer$offer_settlementdate <- iso(offer$offer_settlementdate)
  attr <- r$attr
  if (!is.null(attr)) for (k in names(attr)) if (inherits(attr[[k]], "Date")) attr[[k]] <- if (is.na(attr[[k]])) NA else iso(attr[[k]])
  list(conditions = asw_conditions(), offer = offer, attributes = attr,
       status = if (is.null(res$error)) "computed" else if (startsWith(res$error, "未対応")) "unsupported" else "failed",
       reason = if (is.null(res$error)) "" else res$error, summary = res$summary, yen = res$yen, detail = res$detail,
       jgb = if (is.null(res$error) && identical(attr$currency, "JPY")) asw_jgb_spread(r$attr, r$offer) else NULL,
       validation_issues = I(ASW_VALIDATION[[offer_id]]),
       offer_columns = ASW_OFFER_COLUMNS[ASW_OFFER_COLUMNS$offer_book == r$offer$offer_book, ])
}
