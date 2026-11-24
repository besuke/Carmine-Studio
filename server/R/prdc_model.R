# PRDC note (Coral-Book II-9). Calculations are rmql: the schedule (generate_schedule), the value in
# closed form (each coupon is a floor plus a call spread on the FX rate) and by Monte Carlo (compute_prdc_value), the
# expected coupon of each date and the probabilities of the floor and the cap (compute_forward_option_value: the call
# and its strike sensitivity), and sample FX paths (generate_black_scholes_paths). Reconciled with the manuscript's
# Monte Carlo (GaussQuant) and with QuantLib's blackFormula in server/tests/reconciliation/prdc/.
#
# POST /api/prdc
#   {"note": {"spot": 133.2681, "volPct": 10, "domesticPct": 1, "foreignPct": 3, "discountPct": 0.5,
#             "fxBase": 120, "leveragePct": 12.2, "subtractionPct": 10, "floorPct": 0, "capPct": 2.2},
#    "mc":   {"paths": 3000, "seed": 123}}
# Every field is optional; the defaults are the manuscript's illustrative values.

PRDC_DATES <- list(valuation = as.Date("2023-04-11"), effective = "2015-09-03", termination = "2041-09-03", intro_end = "2016-09-03")
PRDC_NOTIONAL <- 3e8
PRDC_INTRO_RATE <- 0.022
PRDC_DEFAULTS <- list(
  note = list(spot = 133.2681, volPct = 10, domesticPct = 1, foreignPct = 3, discountPct = 0.5,
              fxBase = 120, leveragePct = 12.2, subtractionPct = 10, floorPct = 0, capPct = 2.2),
  mc = list(paths = 3000, seed = 123)
)

prdc_memo_env <- new.env(parent = emptyenv())
prdc_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(prdc_memo_env[[key]])) assign(key, f(), envir = prdc_memo_env)
  prdc_memo_env[[key]]
}

# Coupon schedule (6M, TARGET, modified following, backward), its remaining dates, times and accruals (Actual/360).
PRDC_SCHEDULE <- local({
  d <- PRDC_DATES
  full <- as.Date(rmql::generate_schedule(d$effective, d$termination, "6M", "target", "modified_following", "modified_following", "backward")$date)
  intro <- as.Date(rmql::generate_schedule(d$effective, d$intro_end, "6M", "target", "modified_following", "modified_following", "backward")$date)
  pos <- which(full > d$valuation)
  list(full = full, intro = intro, dates = full[pos], times = as.numeric(full[pos] - d$valuation) / 360,
       accruals = as.numeric(full[pos] - full[pos - 1L]) / 360, accrual_start = full[pos - 1L])
})

prdc_coupon <- function(fx, p) pmin(p$capPct / 100, pmax(p$leveragePct / 100 * fx / p$fxBase - p$subtractionPct / 100, p$floorPct / 100))
# The manuscript discounts at the discount rate and drifts the FX at domestic minus foreign. compute_prdc_value takes
# one domestic curve for both, so the domestic curve is the discount rate and the foreign curve keeps the drift.
prdc_curves <- function(p) {
  v <- PRDC_DATES$valuation
  drift <- (p$domesticPct - p$foreignPct) / 100
  list(domestic = rmql::create_flat_curve(v, p$discountPct / 100, "actual_360", "continuous", index = "tonar"),
       foreign = rmql::create_flat_curve(v, p$discountPct / 100 - drift, "actual_360", "continuous", index = "sofr"),
       drift = drift)
}
prdc_value <- function(p, spot = p$spot, vol = p$volPct / 100, paths = 0, seed = 1) {
  cv <- prdc_curves(p); s <- PRDC_SCHEDULE
  rmql::compute_prdc_value(spot, vol, cv$domestic, cv$foreign, s$times, s$accruals, p$fxBase, p$leveragePct / 100,
                                     p$subtractionPct / 100, p$floorPct / 100, p$capPct / 100, notional = PRDC_NOTIONAL,
                                     paths = paths, seed = seed)$summary
}

prdc_note <- function(p) prdc_memo("note", p, function() {
  s <- PRDC_SCHEDULE; cv <- prdc_curves(p)
  vol <- p$volPct / 100; r <- p$discountPct / 100
  low <- p$fxBase * (p$subtractionPct + p$floorPct) / p$leveragePct
  high <- p$fxBase * (p$subtractionPct + p$capPct) / p$leveragePct
  forward <- p$spot * exp(cv$drift * s$times)
  call_at <- function(k) rmql::compute_forward_option_value("black", "call", forward, k, vol, s$times, 1)
  c_low <- call_at(low); c_high <- call_at(high)
  expected <- p$floorPct / 100 + p$leveragePct / 100 / p$fxBase * (c_low$value - c_high$value)
  df <- exp(-r * s$times)
  n <- length(s$times)
  coupons <- data.frame(
    coupon_number = seq_len(n), accrual_start = format(s$accrual_start), coupon_date = format(s$dates), time = s$times,
    accrual_fraction = s$accruals, expected_fx = forward, coupon_at_expected_fx = prdc_coupon(forward, p),
    expected_coupon_rate = expected,
    # P(S <= low) and P(S >= high): the call's strike sensitivity is -P(S > K) with no discounting
    floor_probability = 1 + c_low$strike_sensitivity, cap_probability = -c_high$strike_sensitivity,
    coupon_amount = PRDC_NOTIONAL * s$accruals * expected, redemption_amount = c(rep(0, n - 1L), PRDC_NOTIONAL),
    discount_factor = df
  )
  coupons$total_amount <- coupons$coupon_amount + coupons$redemption_amount
  coupons$total_present_value <- coupons$total_amount * df
  closed <- prdc_value(p)
  # the coupon's distribution on three dates: the masses at the floor and the cap and the bins between them
  dist_ids <- unique(c(1L, round(n / 2), n))
  distribution <- do.call(rbind, lapply(dist_ids, \(i) {
    edges <- seq(p$floorPct / 100, p$capPct / 100, length.out = 31)
    fx_edges <- p$fxBase * (edges + p$subtractionPct / 100) / (p$leveragePct / 100)
    sd <- vol * sqrt(s$times[i])
    cdf <- stats::pnorm((log(fx_edges / forward[i]) + sd^2 / 2) / sd)
    data.frame(coupon_number = i, coupon_date = format(s$dates[i]), lower = head(edges, -1), upper = tail(edges, -1),
               probability = diff(cdf), kind = "between") |>
      rbind(data.frame(coupon_number = i, coupon_date = format(s$dates[i]), lower = c(p$floorPct, p$capPct) / 100,
                       upper = c(p$floorPct, p$capPct) / 100, probability = c(coupons$floor_probability[i], coupons$cap_probability[i]),
                       kind = c("floor", "cap")))
  }))
  spot_grid <- p$spot * c(0.90, 0.95, 1, 1.05, 1.10)
  vol_grid <- c(0.05, 0.075, vol, 0.125, 0.15)
  spot_curve <- seq(round(p$spot * 0.7), round(p$spot * 1.3), by = 2)
  list(
    valuation_date = format(PRDC_DATES$valuation), notional = PRDC_NOTIONAL, drift = cv$drift,
    domestic_curve_rate = r, foreign_curve_rate = r - cv$drift,
    schedule = list(full = format(s$full), total_dates = length(s$full), remaining = n,
                    intro_dates = length(s$intro), intro_remaining = sum(s$intro > PRDC_DATES$valuation), intro_rate = PRDC_INTRO_RATE),
    thresholds = list(floor_fx = low, cap_fx = high, spot = p$spot),
    payoff = data.frame(fx_rate = seq(70, 180, by = 1)) |>
      transform(uncapped_coupon = p$leveragePct / 100 * seq(70, 180, by = 1) / p$fxBase - p$subtractionPct / 100,
                coupon_rate = prdc_coupon(seq(70, 180, by = 1), p)),
    closed = list(npv = closed$npv, fx_delta = closed$fx_delta, fx_vega = closed$fx_vega,
                  coupon_leg_pv = sum(coupons$coupon_amount * df), redemption_pv = PRDC_NOTIONAL * df[n]),
    coupons = coupons, distribution = distribution,
    spot_scenarios = data.frame(scenario = c("spot_minus_10", "spot_minus_5", "base", "spot_plus_5", "spot_plus_10"), fx_spot = spot_grid,
                                npv = vapply(spot_grid, \(x) prdc_value(p, spot = x)$npv, 0)),
    vol_scenarios = data.frame(scenario = c("vol_5pct", "vol_7_5pct", "base", "vol_12_5pct", "vol_15pct"), fx_volatility = vol_grid,
                               npv = vapply(vol_grid, \(v) prdc_value(p, vol = v)$npv, 0)),
    spot_curve = data.frame(fx_spot = spot_curve, npv = vapply(spot_curve, \(x) prdc_value(p, spot = x)$npv, 0)),
    sample_paths = {
      paths <- rmql::generate_black_scholes_paths(p$spot, r, r - cv$drift, vol, max(s$times), 37L, 20L, sequence = "pseudo", seed = 123)
      unname(lapply(split(paths$price, paths$path_id), unname)) # unnamed, so that JSON has an array of paths
    },
    sample_times = seq(0, max(s$times), length.out = 38)
  )
})

prdc_mc <- function(p, m) prdc_memo("mc", c(p, m), function() {
  v <- prdc_value(p, paths = m$paths, seed = m$seed)
  by_paths <- do.call(rbind, lapply(c(300L, 1000L, 3000L, 10000L, 30000L), \(n) {
    x <- prdc_value(p, paths = n, seed = m$seed)
    data.frame(paths = n, npv = x$npv, standard_error = x$standard_error)
  }))
  list(paths = m$paths, seed = m$seed, npv = v$npv, standard_error = v$standard_error, fx_delta = v$fx_delta, fx_vega = v$fx_vega, by_paths = by_paths)
})

PRDC_NOTE_RANGES <- list(spot = c(50, 250), volPct = c(1, 50), domesticPct = c(-2, 10), foreignPct = c(-2, 15), discountPct = c(-2, 10),
                         fxBase = c(50, 250), leveragePct = c(0.1, 50), subtractionPct = c(0, 50), floorPct = c(0, 10), capPct = c(0, 20))

prdc_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    note = PRDC_NOTE_RANGES,
    mc = list(paths = c(100, 100000), seed = c(1, 1e9))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(PRDC_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(PRDC_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    p
  }
  n <- read("note"); m <- read("mc")
  if (n$capPct <= n$floorPct) bad("キャップはフロアより大きくしてください")
  m$paths <- as.integer(round(m$paths)); m$seed <- as.integer(round(m$seed))
  list(
    inputs = list(note = n, mc = m),
    conventions = list(
      note = "評価日 2023-04-11、契約 2015-09-03〜2041-09-03、6か月ごと（TARGET、Modified Following、Backward）、Actual/360、想定元本 3億円、満期に元本を償還。導入期間の固定クーポンは評価日より前に終わっている",
      model = "FX は対数正規（Garman–Kohlhagen）、ドリフトは国内金利 − 外国金利、割引は割引金利のフラットな連続複利。各クーポンはフロア＋FX のコールスプレッドとして閉じた式で評価する",
      mc = "モンテカルロはクーポン日の FX を直接生成（antithetic）。パス数と seed を変えると値と標準誤差が変わる",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    note = prdc_note(n), mc = prdc_mc(n, m)
  )
}
