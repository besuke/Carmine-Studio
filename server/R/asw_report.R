# The A1 offer-sheet POC (Curie docs/A1_offer_sheet_POC.qmd) as data for the React page, plus the JGB spread of
# yen bonds and the input checks. Sourced after asw_model.R. Calculations are rmql; every number is
# returned together with the old Curie demo's value (curie_reference.json) so the page can show the difference.

ASW_REFERENCE <- jsonlite::fromJSON(file.path(ASW_DATA_DIR, "curie_reference.json"), simplifyVector = TRUE)
ASW_OFFER_COLUMNS <- asw_read_csv("offer_columns.csv")
ASW_JGB <- local({
  j <- utils::read.delim(file.path(ASW_DATA_DIR, "jgb.txt"), sep = "|", encoding = "UTF-8", stringsAsFactors = FALSE)
  for (col in c("marketdate", "settlement_date", "issue_date", "maturity_date")) j[[col]] <- as.Date(j[[col]])
  j
})
ASW_JGB_COMPOUND_FREQUENCY <- 2L # Curie pricing_settings_Curie(jgb_compound_frequency = 2)

# ---- JGB yields and the JGB spread (Curie bond_yield_YEN.R, spread_inputs.R) ------------------------------
# Compound yield in percent from a clean price: remaining years = full years + fraction on ACT/365 (Japanese
# convention), Newton's method, truncated to 7 decimals. rmql implements the same rules as GaussQuant
# bond_compound_yield_from_price_YEN_GQL (rmql docs/spec_bonds.md 5.1, reconciled).
yen_compound_yield <- function(settle, maturity, coupon_rate, price, redemption, coupon_frequency) {
  t <- rmql::compute_remaining_years(settle, maturity)
  list(t = t, yield = rmql::compute_compound_yield_from_price(t, coupon_rate * 100, price, redemption,
                                                                         as.integer(coupon_frequency), ASW_JGB_COMPOUND_FREQUENCY))
}

ASW_JGB_YIELDS <- local({
  j <- ASW_JGB[ASW_JGB$marketdate == ASW_VALUATION_DATE, ]
  rows <- lapply(seq_len(nrow(j)), function(i) {
    r <- j[i, ]
    y <- if (!identical(r$price_type, "clean")) {
      list(t = NA_real_, yield = NA_real_, msg = "単価がクリーン価格ではない")
    } else {
      tryCatch(c(yen_compound_yield(r$settlement_date, r$maturity_date, r$coupon_rate, r$clean_price, r$redemption, r$coupon_frequency), msg = ""),
               error = function(e) list(t = NA_real_, yield = NA_real_, msg = conditionMessage(e)))
    }
    msg <- y$msg
    data.frame(ISIN = r$ISIN, security_name = r$security_name, maturity_date = r$maturity_date, settlement_date = r$settlement_date,
               coupon_rate = r$coupon_rate, coupon_frequency = r$coupon_frequency, clean_price = r$clean_price,
               remaining_years = y$t, compound_yield_pct = y$yield, yield_message = msg, quote_time = r$quote_time)
  })
  do.call(rbind, rows)
})

# Average of the JGBs with the same settlement date, maturity and frequencies (the interpolation points)
asw_jgb_average <- function(settle, coupon_frequency) {
  y <- ASW_JGB_YIELDS[!is.na(ASW_JGB_YIELDS$compound_yield_pct) & ASW_JGB_YIELDS$settlement_date == settle &
                        ASW_JGB_YIELDS$coupon_frequency == coupon_frequency, ]
  m <- sort(unique(y$maturity_date))
  data.frame(maturity_date = m, settlement_date = rep(settle, length(m)),
             jgb_yield_pct_mean = vapply(m, function(d) mean(y$compound_yield_pct[y$maturity_date == d]), 0),
             n_jgbs = vapply(m, function(d) sum(y$maturity_date == d), 0L),
             jgb_isins = vapply(m, function(d) paste(sort(y$ISIN[y$maturity_date == d]), collapse = ", "), ""))
}

# Natural cubic spline of the averages in years from the settlement date (actual days / 365), no extrapolation
asw_jgb_interpolate <- function(settle, maturity, coupon_frequency) {
  p <- asw_jgb_average(settle, coupon_frequency)
  if (!nrow(p)) return(list(value = NA_real_, points = p, message = paste0("受渡日 ", settle, "・利払年", coupon_frequency,
                                                                         "回・複利年2回に合うJGB利回りがない（受渡日の違う単価は使わない）")))
  if (nrow(p) < 2L) return(list(value = NA_real_, points = p, message = "JGB利回りの償還日が2点未満のため補間できない"))
  x <- as.numeric(p$maturity_date - settle) / 365
  x0 <- as.numeric(as.Date(maturity) - settle) / 365
  if (x0 < min(x) || x0 > max(x)) {
    return(list(value = NA_real_, points = p, message = paste0("償還日 ", maturity, " がJGB利回りの範囲（", min(p$maturity_date), "〜",
                                                              max(p$maturity_date), "）外。外挿しない")))
  }
  f <- stats::splinefun(x, p$jgb_yield_pct_mean, method = "natural")
  list(value = f(x0), points = p, message = "", spline = f, x = x)
}

# JGB spread of a yen bond: (compound yield of the bond - interpolated JGB compound yield) x 100, in bp
asw_jgb_spread <- function(attr, offer) {
  if (!identical(attr$currency, "JPY")) return(NULL)
  y <- tryCatch(yen_compound_yield(offer$offer_settlementdate, attr$maturity_date, attr$coupon_rate, offer$offer_price,
                                   attr$redemption, attr$coupon_frequency), error = function(e) NULL)
  if (is.null(y)) return(list(status = "not_computed", reason = "対象債の複利利回りを計算できない"))
  ip <- asw_jgb_interpolate(offer$offer_settlementdate, attr$maturity_date, attr$coupon_frequency)
  list(status = if (is.na(ip$value)) "not_computed" else "computed", reason = ip$message,
       remaining_years = y$t, compound_yield_pct = y$yield, jgb_interpolated_yield_pct = ip$value,
       jgb_spread_bp = (y$yield - ip$value) * 100)
}

# A quote given as a spread over JGBs, back to a price. Curie has no such input (offer_price is required); this is
# the inverse of Curie's own definition of the JGB spread above, with the same yield convention:
#   y = interpolated JGB compound yield + spread / 100,  price = compound-yield price of the bond at y.
# Prices are returned untruncated and truncated to 3 decimals (the Japanese convention of the price function).
asw_price_from_jgb_spread <- function(attr, offer, spread_bp) {
  ip <- asw_jgb_interpolate(offer$offer_settlementdate, attr$maturity_date, attr$coupon_frequency)
  if (is.na(ip$value)) return(list(error = ip$message))
  t <- rmql::compute_remaining_years(offer$offer_settlementdate, attr$maturity_date)
  y <- ip$value + spread_bp / 100
  args <- list(t, attr$coupon_rate * 100, y, attr$redemption, as.integer(attr$coupon_frequency), ASW_JGB_COMPOUND_FREQUENCY)
  # The help of rmql 0.3.0 says digits = NA keeps all decimals, but the R function rejects NA
  # ("Must not be NA"). Truncating at 20 decimals leaves a price of about 100 unchanged up to its last bit.
  price <- do.call(rmql::compute_price_from_compound_yield, c(args, list(digits = 20L)))
  price3 <- do.call(rmql::compute_price_from_compound_yield, c(args, list(digits = 3L)))
  back <- yen_compound_yield(offer$offer_settlementdate, attr$maturity_date, attr$coupon_rate, price, attr$redemption, attr$coupon_frequency)
  list(spread_bp = spread_bp, jgb_interpolated_yield_pct = ip$value, compound_yield_pct = y, remaining_years = t,
       clean_price = price, clean_price_3dp = price3,
       round_trip_spread_bp = (back$yield - ip$value) * 100)
}

# ---- Input checks (Curie workflows_validate_worksheet + validate_offer_worksheet_Curie) --------------------
isin_check_digit <- function(body) {
  chars <- strsplit(toupper(body), "")[[1]]
  digits <- as.integer(strsplit(paste(vapply(chars, function(ch) if (grepl("[0-9]", ch)) ch else as.character(match(ch, LETTERS) + 9L), ""),
                                      collapse = ""), "")[[1]])
  rev_digits <- rev(digits)
  doubled <- ifelse(seq_along(rev_digits) %% 2L == 1L, rev_digits * 2L, rev_digits)
  as.integer((10L - sum(doubled %/% 10L + doubled %% 10L) %% 10L) %% 10L)
}

# The codes in Curie's order: first those of the ported Coral-Book checks, then Curie's own.
asw_validation_issues <- function(offer, attr, duplicate) {
  blank <- function(x) is.null(x) || length(x) == 0L || is.na(x) || !nzchar(trimws(as.character(x)))
  isin <- toupper(trimws(offer$ISIN))
  isin_ok_format <- grepl("^[A-Z]{2}[A-Z0-9]{9}[0-9]$", isin)
  # as.character: no issue gives character(0), which is written as [] (c() of nothing would be NULL)
  as.character(c(
    if (blank(offer$ISIN)) "missing_ISIN" else if (!isin_ok_format) "invalid_ISIN_format",
    if (blank(offer$broker_names)) "missing_broker_names",
    if (duplicate) "duplicate_offer_key",
    if (is.na(offer$offer_price) || offer$offer_price <= 0) "invalid_offer_price",
    if (is.na(offer$offer_size) || offer$offer_size <= 0) "invalid_offer_size",
    if (is.na(offer$offer_settlementdate)) "missing_offer_settlementdate" else if (offer$offer_settlementdate < offer$offer_date) "settlement_before_offer",
    if (is.null(attr)) "missing_bond_attributes",
    if (!is.null(attr) && !attr$coupon_type %in% "FIXED") "unsupported_coupon_type",
    if (!is.null(attr) && !is.na(attr$coupon_rate) && attr$coupon_rate < 0) "invalid_coupon_rate",
    if (!is.null(attr) && !attr$coupon_frequency %in% c(1, 2, 4, 12)) "unsupported_coupon_frequency",
    if (!is.null(attr) && !is.na(attr$redemption) && attr$redemption <= 0) "invalid_redemption",
    if (!is.null(attr) && attr$issue_date >= attr$maturity_date) "invalid_bond_dates",
    if (!is.null(attr) && attr$issue_date > offer$offer_settlementdate) "issue_after_settlement",
    if (!is.null(attr) && attr$maturity_date <= offer$offer_settlementdate) "matured_at_settlement",
    # Curie's own checks
    if (offer$offer_date != ASW_VALUATION_DATE) "offer_date_not_valuation_date",
    if (!is.null(attr) && (!identical(attr$coupon_type, "FIXED") || !is.na(attr$first_call_date))) "unsupported_product",
    if (isin_ok_format && as.integer(substr(isin, 12, 12)) != isin_check_digit(substr(isin, 1, 11))) "invalid_ISIN_check_digit",
    if (!is.null(attr) && attr$redemption > 0 && abs(attr$redemption - 100) > 1e-12) "unsupported_redemption_not_100",
    if (!is.null(attr) && !identical(attr$redemption_type, "BULLET")) "unsupported_redemption_type",
    if (!is.null(attr) && !is.na(offer$offer_currency) && offer$offer_currency != attr$currency) "offer_currency_mismatch",
    if (!is.null(attr) && !is.na(offer$sheet_issue_price) && abs(offer$sheet_issue_price - attr$issue_price) > 1e-9) "sheet_issue_price_mismatch",
    if (identical(offer$offer_book, "JPY") && !any(ASW_JGB$marketdate == ASW_VALUATION_DATE)) "missing_JGB_prices",
    if (identical(offer$offer_book, "ISO") && !is.null(attr) && attr$currency != "JPY" &&
        !any(ASW_DATA$fx$marketdate == ASW_VALUATION_DATE & ASW_DATA$fx$base_currency == attr$currency)) "missing_FX_spot",
    if (identical(offer$offer_book, "ISO") && !is.null(attr) && attr$currency != "JPY" && !is.null(ASW_CURRENCIES[[attr$currency]]) &&
        nrow(asw_basis_points(attr$currency)) == 0L) "missing_CCS_basis"
  ))
}

ASW_VALIDATION <- local({
  o <- ASW_DATA$offers
  key <- paste(o$offer_date, o$ISIN, o$broker_names)
  dup <- duplicated(key) | duplicated(key, fromLast = TRUE)
  rows <- asw_offer_rows()
  stats::setNames(lapply(seq_along(rows), function(i) asw_validation_issues(rows[[i]]$offer, rows[[i]]$attr, dup[i])), o$offer_id)
})

# ---- The POC report --------------------------------------------------------------------------------------
asw_ref_row <- function(isin) {
  r <- ASW_REFERENCE$results
  r[r$ISIN == isin, , drop = FALSE]
}

asw_report <- function() {
  rows <- asw_offer_rows()
  offers <- lapply(rows, function(r) {
    o <- r$offer
    a <- r$attr
    priced <- if (nzchar(r$reason)) list(error = r$reason) else tryCatch(asw_price(r), error = function(e) list(error = conditionMessage(e)))
    jgb <- if (!is.null(a) && is.null(priced$error)) asw_jgb_spread(a, o) else NULL
    yen <- priced$yen
    issues <- ASW_VALIDATION[[o$offer_id]]
    unsupported_codes <- c("unsupported_product", "unsupported_coupon_type", "unsupported_coupon_frequency",
                           "unsupported_redemption_not_100", "unsupported_redemption_type")
    status <- if (length(issues) && all(issues %in% unsupported_codes)) "unsupported" else if (length(issues)) "skipped" else
      if (!is.null(priced$error)) "failed" else if ((identical(a$currency, "JPY") && !identical(jgb$status, "computed")) ||
                                                    (!identical(a$currency, "JPY") && !identical(yen$status, "computed"))) "partial" else "success"
    message <- if (status == "unsupported") paste0(r$reason, "（固定利付債として代用しない）") else if (status == "skipped") paste("入力検証で不合格:", paste(issues, collapse = "; ")) else
      if (status == "failed") priced$error else if (status == "partial") (if (identical(a$currency, "JPY")) paste0("JGBスプレッド未計算: ", jgb$reason) else paste0("円換算ASW未計算: ", yen$reason)) else ""
    ref <- asw_ref_row(o$ISIN)
    list(
      offer_id = o$offer_id, book = o$offer_book, ISIN = o$ISIN,
      security_name = if (is.null(a)) o$offer_security_name else a$security_name, currency = if (is.null(a)) o$offer_currency else a$currency,
      offer_price = o$offer_price, settlement_date = iso(o$offer_settlementdate),
      validation_status = if (length(issues)) "invalid" else "valid", validation_issues = I(issues), # I(): always a JSON array, even with one code
      pricing_status = status, pricing_message = message,
      native_asw_bp = priced$summary$fair_spread_bp %||% NA,
      asw_effective_date = priced$summary$effective_date %||% NA,
      jpy_compound_yield_pct = jgb$compound_yield_pct %||% NA, jgb_interpolated_yield_pct = jgb$jgb_interpolated_yield_pct %||% NA,
      jgb_spread_bp = jgb$jgb_spread_bp %||% NA,
      fx_spot = yen$fx_spot %||% NA, basis_bp = yen$basis_bp %||% NA, yen_asw_bp = yen$yen_asw_bp %||% NA,
      simple_sum_bp = yen$simple_sum_bp %||% NA, calibrated_discount_spread_bp = yen$calibrated_discount_spread_bp %||% NA,
      calculation_end_date = if (is.null(a)) NA else iso(a$maturity_date),
      reference = if (nrow(ref) == 1L) as.list(ref) else NULL
    )
  })
  # yen residuals need the detailed calibration
  residuals <- lapply(Filter(function(x) x$book == "ISO" && x$pricing_status == "success", offers), function(x) {
    r <- Filter(function(rr) identical(rr$offer$offer_id, x$offer_id), rows)[[1]]
    d <- asw_price(r, detail = TRUE)$yen$detail
    list(offer_id = x$offer_id, ISIN = x$ISIN, security_name = x$security_name, currency = x$currency, fx_spot = d$fx$spot,
         fx_spot_date = d$fx$spot_date, asw_effective_date = x$asw_effective_date, calibrated_discount_spread_bp = d$components$z_bp,
         ccs_residual_yen = d$checks$ccs_residual_yen, fair_spread_residual_yen = d$checks$npv_at_fair_spread_yen,
         reference = as.list(asw_ref_row(x$ISIN)))
  })
  curve_check <- lapply(names(ASW_CURVES), function(ccy) {
    cv <- ASW_CURVES[[ccy]]
    list(currency = ccy, status = if (is.null(cv$error)) "success" else "failed", index = ASW_CURRENCIES[[ccy]]$index_name,
         marketdate = iso(ASW_VALUATION_DATE), quote_time = cv$quote_time %||% NA, quotes = nrow(cv$quotes %||% data.frame()),
         max_abs_quote_error_bp = if (is.null(cv$error)) max(cv$repricing$reproduction_error) * 1e4 else NA,
         last_pillar = if (is.null(cv$error)) iso(cv$last_date) else NA)
  })
  settle <- unique(ASW_DATA$offers$offer_settlementdate[ASW_DATA$offers$offer_book == "JPY"])
  jgb_points <- asw_jgb_average(settle[1], 2L)
  jgb_curve <- if (nrow(jgb_points) >= 2L) {
    x <- as.numeric(jgb_points$maturity_date - settle[1]) / 365
    grid <- seq(min(x), max(x), length.out = 150)
    f <- stats::splinefun(x, jgb_points$jgb_yield_pct_mean, method = "natural")
    data.frame(time = grid, date = iso(settle[1] + round(grid * 365)), yield_pct = f(grid))
  } else NULL
  basis_all <- ASW_DATA$basis[ASW_DATA$basis$marketdate == ASW_VALUATION_DATE, ]
  basis_avg <- unique(basis_all[, c("currency_pair", "currency", "notional_type", "maturity_date")])
  basis_avg <- basis_avg[order(basis_avg$currency_pair, basis_avg$maturity_date, basis_avg$notional_type), ]
  basis_table <- lapply(seq_len(nrow(basis_avg)), function(i) {
    k <- basis_avg[i, ]
    q <- basis_all[basis_all$currency_pair == k$currency_pair & basis_all$notional_type == k$notional_type & basis_all$maturity_date == k$maturity_date, ]
    list(currency_pair = k$currency_pair, notional_type = k$notional_type, maturity_date = iso(k$maturity_date),
         n_quotes = nrow(q), basis_bp_mean = mean(q$basis_bp), quote_sources = paste(sort(unique(q$quote_source)), collapse = ", "),
         used = identical(k$notional_type, "constant"))
  })
  basis_curves <- lapply(c("USD", "EUR"), function(ccy) {
    p <- asw_basis_points(ccy)
    grid <- seq(min(p$time), max(p$time), length.out = 120)
    f <- stats::splinefun(p$time, p$basis_bp, method = "natural")
    list(currency = ccy, points = data.frame(maturity_date = iso(p$maturity_date), time = p$time, basis_bp = p$basis_bp),
         curve = data.frame(time = grid, date = iso(ASW_VALUATION_DATE + round(grid * 365)), basis_bp = f(grid)))
  })
  inputs <- function(book) {
    list(offer_file = unique(ASW_DATA$offers$offer_source_file[ASW_DATA$offers$offer_book == book]),
         columns = ASW_OFFER_COLUMNS[ASW_OFFER_COLUMNS$offer_book == book, ],
         market_log = ASW_REFERENCE$market_log[[book]])
  }
  list(
    conditions = asw_conditions(),
    valuation_date = iso(ASW_VALUATION_DATE),
    reference_note = ASW_REFERENCE$conditions,
    inputs = list(JPY = inputs("JPY"), ISO = inputs("ISO")),
    attributes_source = I(unique(ASW_DATA$attributes$attribute_source)), # I(): always a JSON array
    offers = offers,
    curve_check = curve_check,
    curve_reference = ASW_REFERENCE$curves,
    jgb = list(yields = ASW_JGB_YIELDS |> transform(maturity_date = iso(maturity_date), settlement_date = iso(settlement_date)),
               reference_yields = ASW_REFERENCE$jgb_yields, average = transform(jgb_points, maturity_date = iso(maturity_date), settlement_date = iso(settlement_date)),
               reference_average = ASW_REFERENCE$jgb_average, curve = jgb_curve, settlement_date = iso(settle[1])),
    basis = list(table = basis_table, reference = ASW_REFERENCE$basis_average, curves = basis_curves),
    residuals = residuals,
    provenance = readLines(file.path(ASW_DATA_DIR, "PROVENANCE.md"), encoding = "UTF-8")
  )
}

# POST /api/asw/offers/<id>/jgb-spread   {"spreadBp": 11.5}
asw_jgb_spread_quote <- function(offer_id, spread_bp) {
  rows <- asw_offer_rows()
  hit <- Filter(function(r) identical(r$offer$offer_id, offer_id), rows)
  if (!length(hit)) return(list(status = 404L, body = list(error = paste("No such offer:", offer_id))))
  r <- hit[[1]]
  if (is.null(r$attr) || !identical(r$attr$currency, "JPY")) return(list(status = 400L, body = list(error = "JGB対比スプレッドは円建ての債券だけ")))
  if (nzchar(r$reason)) return(list(status = 400L, body = list(error = r$reason)))
  if (!is.numeric(spread_bp) || length(spread_bp) != 1L || !is.finite(spread_bp) || abs(spread_bp) > 1000) {
    return(list(status = 400L, body = list(error = "spreadBp must be a finite number with |spreadBp| <= 1000")))
  }
  conv <- asw_price_from_jgb_spread(r$attr, r$offer, spread_bp)
  if (!is.null(conv$error)) return(list(status = 400L, body = list(error = conv$error)))
  # The ASW at the converted price (untruncated)
  bond <- asw_bond(r$attr)
  v <- rmql::compute_ois_asset_swap(bond, conv$clean_price, ASW_CURVES$JPY$curve, ASW_VALUATION_DATE,
                                              payment_frequency = ASW_SETTINGS$asw_payment_frequency, payment_lag = ASW_SETTINGS$asw_payment_lag,
                                              on_error = "na")
  list(status = 200L, body = c(conv, list(offer_id = offer_id, native_asw_bp = v$fair_spread_bp,
                                          assumption = paste("Curie にはJGB対比スプレッドで提示された気配の入力がない。",
                                                             "ここでは Curie のJGBスプレッドの定義（対象債の複利利回り − 同じ償還日に補間したJGB複利利回り、",
                                                             "複利年2回・同じ受渡日）を逆に解いて価格に換算する。",
                                                             "特定のベンチマーク銘柄対比や単利利回りでの提示には対応しない"))))
}
