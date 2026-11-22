# Reconcile JPY TONA OIS curve construction and valuation: GaussQuant (QuantLib, reference) vs rmql.
#
# Run from anywhere:
#   "C:/Program Files/R/R-4.6.0/bin/Rscript.exe" C:/AnalyticFin/Projects/Carmine-Studio/server/tests/reconciliation/reconcile_tona_ois.R
#
# Writes raw (unrounded) results to server/tests/reconciliation/results/*.csv. Nothing in GaussQuant or rmql is modified.

suppressPackageStartupMessages({
  library(GaussQuant)
  library(QuantLib)
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
})

out_dir <- "C:/AnalyticFin/Projects/Carmine-Studio/server/tests/reconciliation/results"
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# ---------------------------------------------------------------------------
# 1. Common inputs
# ---------------------------------------------------------------------------

evaluation_date <- "2026-09-10"
notional_jpy <- 1e10 # 10 billion yen
bump_quote_id <- "TONAR-5Y"
bump_size <- 1e-4 # +1 bp in decimal
swap_years <- 7L

# Tolerances (rationale in RECONCILIATION.md)
tol <- list(
  date = 0, # exact
  df_rel_log_linear = 1e-12,
  df_abs_log_cubic = 2e-12,
  rate_abs = 1e-10,
  quote_reproduction_abs = 1e-9,
  pv_abs_jpy = 1e-11 * notional_jpy, # 0.1 yen
  pv_diff_abs_jpy = 2e-11 * notional_jpy # 0.2 yen (difference of two values)
)

base_quotes <- GaussQuant::bluegamma_tonar_quotes_GQL()

quote_sets <- list(
  with_7y = base_quotes,
  without_7y = dplyr::filter(base_quotes, quote_id != "TONAR-7Y")
)

bump_quotes <- function(q) {
  q$rate[q$quote_id == bump_quote_id] <- q$rate[q$quote_id == bump_quote_id] + bump_size
  q$rate_pct <- 100 * q$rate
  q
}

tenor_label <- function(n, unit) paste0(n, ifelse(unit == "Years", "Y", "M"))

interpolations <- tibble::tribble(
  ~interp, ~gq_curve_type, ~rfm_interpolation,
  "log_linear", "log_linear_discount", "log_linear",
  "monotonic_log_cubic", "log_cubic_discount", "monotonic_log_cubic"
)

# ---------------------------------------------------------------------------
# 2. Engine wrappers
# ---------------------------------------------------------------------------

iso <- function(d) GaussQuant::iso_GQL(d)

gq_build <- function(q, curve_type) {
  GaussQuant::build_tonar_curve_from_market_GQL(
    quotes = q, evaluation_date = evaluation_date, curve_type = curve_type, extrapolate = TRUE
  )
}

rfm_build <- function(q, interpolation) {
  instruments <- rmql::create_ois_instruments(
    tenor = tenor_label(q$tenor_n, q$tenor_unit),
    rate = q$rate,
    settlement_days = q$fixing_days, # 2 business days, as GaussQuant passes to OISRateHelper
    payment_frequency = 1L, # QuantLib OISRateHelper default Annual
    payment_lag = 0L # QuantLib OISRateHelper default 0
  )
  curve <- rmql::bootstrap_ois_curve(
    evaluation_date, evaluation_date, "tonar", "actual_365_fixed", instruments,
    interpolation = interpolation, accuracy = 1e-12
  )
  rmql::with_extrapolation(curve)
}

gq_discount <- function(bundle, dates) {
  purrr::map_dbl(as.character(dates), function(d) bundle$curve$discount(GaussQuant::date_GQL(d)))
}

gq_forward_1d <- function(bundle, dates) {
  dc <- QuantLib::Actual365Fixed()
  purrr::map_dbl(as.character(dates), function(d) {
    bundle$curve$forwardRate(
      GaussQuant::date_GQL(d), GaussQuant::date_GQL(as.character(as.Date(d) + 1L)), dc, "Simple"
    )$rate()
  })
}

gq_helpers <- function(bundle) {
  purrr::map2_dfr(bundle$helpers, bundle$quotes$quote_id, function(h, id) {
    tibble::tibble(
      quote_id = id,
      start_date = as.Date(iso(h$swap()$startDate())),
      maturity_date = as.Date(iso(h$maturityDate())),
      pillar_date = as.Date(iso(h$pillarDate())),
      latest_relevant_date = as.Date(iso(h$latestRelevantDate())),
      implied_rate = h$impliedQuote()
    )
  })
}

gq_swap <- function(bundle, fixed_rate) {
  idx <- QuantLib::Tonar(bundle$curve_handle)
  GaussQuant::build_ois_GQL(QuantLib::Period(swap_years, "Years"), idx, fixed_rate) # nominal 1, payer
}

# ---------------------------------------------------------------------------
# 3. 7Y OIS dates on the rmql side, derived with rmql's own calendar functions (MakeOIS rule)
# ---------------------------------------------------------------------------

rfm_spot <- rmql::compute_advanced_date(
  "japan", rmql::compute_adjusted_date("japan", evaluation_date), "2D"
)
rfm_eom <- rmql::compute_end_of_month("japan", rfm_spot) == rfm_spot
rfm_end <- seq(rfm_spot, by = paste(swap_years, "years"), length.out = 2L)[2L]
if (isTRUE(rfm_eom)) rfm_end <- rmql::compute_end_of_month("japan", rfm_end)

rfm_swap <- function(fixed_rate, nominal) {
  rmql::create_ois_swap(
    "payer", nominal, rfm_spot, rfm_end, "tonar", fixed_rate,
    fixed_frequency = 1L, overnight_frequency = 1L, payment_lag = 0L
  )
}

# ---------------------------------------------------------------------------
# 4. Run all configurations
# ---------------------------------------------------------------------------

key_tenors <- c(1L, 2L, 3L, 5L, 7L, 10L, 15L, 20L, 30L)
grid_dates <- seq(as.Date(evaluation_date) + 1L, as.Date("2056-09-10"), by = "1 month")

results <- list()
for (qs_name in names(quote_sets)) {
  for (i in seq_len(nrow(interpolations))) {
    conf <- interpolations[i, ]
    cases <- list(base = quote_sets[[qs_name]], bump_5y = bump_quotes(quote_sets[[qs_name]]))

    # GaussQuant base curve first: its unrounded 7Y par rate is the fixed rate for every case and engine.
    gq_base <- gq_build(cases$base, conf$gq_curve_type)
    fixed_rate <- gq_swap(gq_base, 0)$fairRate()

    for (case in names(cases)) {
      q <- cases[[case]]
      GaussQuant::set_eval_date_GQL(evaluation_date)
      gq <- if (case == "base") gq_base else gq_build(q, conf$gq_curve_type)
      rfm <- rfm_build(q, conf$rfm_interpolation)

      # Instruments
      h_gq <- gq_helpers(gq)
      h_rfm <- rmql::get_quote_repricing(rfm)
      inst <- h_gq |>
        dplyr::mutate(
          quote = q$rate,
          rfm_start_date = h_rfm$start_date, rfm_maturity_date = h_rfm$maturity_date,
          rfm_pillar_date = h_rfm$pillar_date, rfm_latest_relevant_date = h_rfm$latest_relevant_date,
          rfm_used_in_bootstrap = h_rfm$used_in_bootstrap, rfm_implied_rate = h_rfm$implied_rate
        )

      # Discount factors: pillars, key anniversaries, swap payment dates, monthly grid
      sw_gq0 <- gq_swap(gq, fixed_rate)
      fixed_tbl <- GaussQuant::swap_fixed_leg_table_GQL(sw_gq0)
      on_tbl <- GaussQuant::ois_overnight_leg_table_GQL(sw_gq0)
      pts <- dplyr::bind_rows(
        tibble::tibble(kind = "pillar", label = h_gq$quote_id, date = h_gq$pillar_date),
        tibble::tibble(
          kind = "key_tenor", label = paste0(key_tenors, "Y"),
          date = purrr::map_vec(key_tenors, function(n) seq(as.Date(evaluation_date), by = paste(n, "years"), length.out = 2L)[2L])
        ),
        tibble::tibble(kind = "swap_payment", label = paste0("pay", seq_len(nrow(fixed_tbl))), date = as.Date(fixed_tbl$date)),
        tibble::tibble(kind = "swap_start", label = "start", date = as.Date(iso(sw_gq0$startDate()))),
        tibble::tibble(kind = "grid", label = format(grid_dates), date = grid_dates)
      )
      dfs <- pts |>
        dplyr::mutate(
          gq_df = gq_discount(gq, date),
          rfm_df = rmql::compute_discount(rfm, date),
          gq_fwd_1d = gq_forward_1d(gq, date),
          rfm_fwd_1d = rmql::compute_forward_rate(rfm, date, date + 1L, "actual_365_fixed", "simple")
        )

      # 7Y OIS: unit-nominal GaussQuant NPV scaled to yen; rmql at the yen notional and at 1
      sw_rfm <- rfm_swap(fixed_rate, notional_jpy)
      v_rfm <- rmql::compute_ois_swap_value(sw_rfm, rfm, evaluation_date)
      v_rfm1 <- rmql::compute_ois_swap_value(rfm_swap(fixed_rate, 1), rfm, evaluation_date)
      par_gq <- gq_swap(gq, 0)$fairRate()
      swap_row <- tibble::tibble(
        fixed_rate = fixed_rate,
        gq_start = as.Date(iso(sw_gq0$startDate())), gq_maturity = as.Date(iso(sw_gq0$maturityDate())),
        rfm_start = rfm_spot, rfm_maturity = rfm_end,
        gq_par_rate = par_gq, rfm_par_rate = v_rfm$fair_rate,
        gq_pv_jpy = sw_gq0$NPV() * notional_jpy, rfm_pv_jpy = v_rfm$npv, rfm_pv_unit_scaled_jpy = v_rfm1$npv * notional_jpy,
        gq_fixed_leg_jpy = sw_gq0$legNPV(0L) * notional_jpy, rfm_fixed_leg_jpy = v_rfm$fixed_leg_npv,
        gq_overnight_leg_jpy = sw_gq0$legNPV(1L) * notional_jpy, rfm_overnight_leg_jpy = v_rfm$overnight_leg_npv
      )

      # Cash flows
      cf_rfm <- rmql::compute_ois_swap_cashflows(sw_rfm, rfm, evaluation_date)
      cf <- dplyr::bind_rows(
        tibble::tibble(leg = "fixed", n = seq_len(nrow(fixed_tbl)), gq_date = as.Date(fixed_tbl$date), gq_amount_jpy = fixed_tbl$amount * notional_jpy),
        tibble::tibble(leg = "overnight", n = seq_len(nrow(on_tbl)), gq_date = as.Date(on_tbl$date), gq_amount_jpy = on_tbl$amount * notional_jpy)
      ) |>
        dplyr::left_join(
          cf_rfm |> dplyr::group_by(leg) |> dplyr::mutate(n = dplyr::row_number()) |> dplyr::ungroup() |>
            dplyr::transmute(leg, n, rfm_date = payment_date, rfm_accrual_start = accrual_start, rfm_accrual_end = accrual_end, rfm_amount_jpy = amount),
          by = c("leg", "n")
        )

      tag <- function(x) dplyr::mutate(x, quote_set = qs_name, interp = conf$interp, case = case, .before = 1)
      results$inst[[length(results$inst) + 1L]] <- tag(inst)
      results$dfs[[length(results$dfs) + 1L]] <- tag(dfs)
      results$swap[[length(results$swap) + 1L]] <- tag(swap_row)
      results$cf[[length(results$cf) + 1L]] <- tag(cf)
    }
  }
}

inst <- dplyr::bind_rows(results$inst)
dfs <- dplyr::bind_rows(results$dfs)
swap <- dplyr::bind_rows(results$swap)
cf <- dplyr::bind_rows(results$cf)

# ---------------------------------------------------------------------------
# 5. Differences and judgements
# ---------------------------------------------------------------------------

dfs <- dfs |>
  dplyr::mutate(
    df_abs_diff = rfm_df - gq_df,
    df_rel_diff = df_abs_diff / gq_df,
    fwd_abs_diff = rfm_fwd_1d - gq_fwd_1d,
    df_pass = ifelse(interp == "log_linear", abs(df_rel_diff) <= tol$df_rel_log_linear, abs(df_abs_diff) <= tol$df_abs_log_cubic),
    fwd_pass = abs(fwd_abs_diff) <= tol$rate_abs
  )

inst <- inst |>
  dplyr::mutate(
    dates_match = start_date == rfm_start_date & maturity_date == rfm_maturity_date &
      pillar_date == rfm_pillar_date & latest_relevant_date == rfm_latest_relevant_date,
    implied_abs_diff = rfm_implied_rate - implied_rate,
    gq_reproduction = abs(implied_rate - quote),
    rfm_reproduction = abs(rfm_implied_rate - quote),
    implied_pass = abs(implied_abs_diff) <= tol$rate_abs,
    reproduction_pass = gq_reproduction <= tol$quote_reproduction_abs & rfm_reproduction <= tol$quote_reproduction_abs
  )

swap <- swap |>
  dplyr::mutate(
    dates_match = gq_start == rfm_start & gq_maturity == rfm_maturity,
    par_abs_diff = rfm_par_rate - gq_par_rate,
    pv_abs_diff_jpy = rfm_pv_jpy - gq_pv_jpy,
    pv_unit_scaled_vs_direct_jpy = rfm_pv_unit_scaled_jpy - rfm_pv_jpy,
    par_pass = abs(par_abs_diff) <= tol$rate_abs,
    pv_pass = abs(pv_abs_diff_jpy) <= tol$pv_abs_jpy
  )

swap_delta <- swap |>
  dplyr::select(quote_set, interp, case, fixed_rate, gq_par_rate, rfm_par_rate, gq_pv_jpy, rfm_pv_jpy) |>
  tidyr::pivot_wider(names_from = case, values_from = c(gq_par_rate, rfm_par_rate, gq_pv_jpy, rfm_pv_jpy)) |>
  dplyr::mutate(
    gq_par_change_bp = 1e4 * (gq_par_rate_bump_5y - gq_par_rate_base),
    rfm_par_change_bp = 1e4 * (rfm_par_rate_bump_5y - rfm_par_rate_base),
    par_change_diff_bp = rfm_par_change_bp - gq_par_change_bp,
    gq_pv_change_jpy = gq_pv_jpy_bump_5y - gq_pv_jpy_base,
    rfm_pv_change_jpy = rfm_pv_jpy_bump_5y - rfm_pv_jpy_base,
    pv_change_diff_jpy = rfm_pv_change_jpy - gq_pv_change_jpy,
    initial_pv_zero_pass = abs(gq_pv_jpy_base) <= tol$pv_abs_jpy & abs(rfm_pv_jpy_base) <= tol$pv_abs_jpy,
    pv_change_pass = abs(pv_change_diff_jpy) <= tol$pv_diff_abs_jpy
  )

cf <- cf |>
  dplyr::mutate(date_match = gq_date == rfm_date, amount_abs_diff_jpy = rfm_amount_jpy - gq_amount_jpy,
                amount_pass = abs(amount_abs_diff_jpy) <= tol$pv_abs_jpy)

summary_tbl <- dplyr::bind_rows(
  inst |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "instrument dates / implied rate", n = dplyr::n(),
    max_abs_diff = max(abs(implied_abs_diff)), fails = sum(!dates_match) + sum(!implied_pass), .groups = "drop"),
  inst |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "quote reproduction (max of both engines)", n = dplyr::n(),
    max_abs_diff = max(gq_reproduction, rfm_reproduction), fails = sum(!reproduction_pass), .groups = "drop"),
  dfs |> dplyr::filter(kind != "grid") |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "discount factor (pillars, key tenors, swap dates)", n = dplyr::n(),
    max_abs_diff = max(abs(df_abs_diff)), fails = sum(!df_pass), .groups = "drop"),
  dfs |> dplyr::filter(kind == "grid") |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "discount factor (monthly grid to 30Y)", n = dplyr::n(),
    max_abs_diff = max(abs(df_abs_diff)), fails = sum(!df_pass), .groups = "drop"),
  dfs |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "1-day simple forward (all dates)", n = dplyr::n(),
    max_abs_diff = max(abs(fwd_abs_diff)), fails = sum(!fwd_pass), .groups = "drop"),
  cf |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "7Y OIS cash flows (date, amount JPY)", n = dplyr::n(),
    max_abs_diff = max(abs(amount_abs_diff_jpy)), fails = sum(!date_match) + sum(!amount_pass), .groups = "drop"),
  swap |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "7Y par rate", n = dplyr::n(), max_abs_diff = max(abs(par_abs_diff)), fails = sum(!par_pass) + sum(!dates_match), .groups = "drop"),
  swap |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "7Y OIS PV (JPY)", n = dplyr::n(), max_abs_diff = max(abs(pv_abs_diff_jpy)), fails = sum(!pv_pass), .groups = "drop"),
  swap_delta |> dplyr::group_by(quote_set, interp) |> dplyr::summarise(
    item = "7Y OIS PV change (JPY)", n = dplyr::n(), max_abs_diff = max(abs(pv_change_diff_jpy)),
    fails = sum(!pv_change_pass) + sum(!initial_pv_zero_pass), .groups = "drop")
) |> dplyr::arrange(quote_set, interp)

# ---------------------------------------------------------------------------
# 6. Write
# ---------------------------------------------------------------------------

w <- function(x, f) utils::write.csv(x, file.path(out_dir, f), row.names = FALSE)
w(dplyr::bind_rows(purrr::imap(quote_sets, function(q, nm) dplyr::mutate(q, quote_set = nm, .before = 1))), "quotes.csv")
w(inst, "instruments.csv")
w(dfs, "discount_forward.csv")
w(cf, "cashflows.csv")
w(swap, "swap_7y.csv")
w(swap_delta, "swap_7y_change.csv")
w(summary_tbl, "summary.csv")

writeLines(c(
  paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
  paste("R:", R.version.string),
  paste("QuantLib (R):", as.character(packageVersion("QuantLib"))),
  paste("GaussQuant:", as.character(packageVersion("GaussQuant")), "built", packageDescription("GaussQuant")$Built),
  paste("rmql:", as.character(packageVersion("rmql")), "built", packageDescription("rmql")$Built),
  paste("rmql path:", find.package("rmql"))
), file.path(out_dir, "session_info.txt"))

options(width = 200, pillar.sigfig = 10)
print(summary_tbl, n = 100)
print(swap_delta |> dplyr::select(quote_set, interp, fixed_rate, gq_par_change_bp, rfm_par_change_bp, gq_pv_jpy_base, rfm_pv_jpy_base,
                                   gq_pv_change_jpy, rfm_pv_change_jpy, pv_change_diff_jpy), width = 250)
