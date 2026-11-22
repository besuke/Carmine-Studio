# Reconcile the JGB futures chapter (Coral Book II-2.6–2.7) and the futures BPV:
# GaussQuant / QuantLib 1.42 (the manuscript's code) against rmql, on the same fictitious inputs
# (server/data/futures_demo/inputs.json), plus the values that do not depend on the market prices and the stress
# scenario against the manuscript's own results (rmql comparison/baseline/lagrange_values.csv).
#
#   node ui/scripts/run-r.mjs server/tests/reconciliation/futures/reconcile_futures.R
#
# Writes server/tests/golden/futures_golden.json (GaussQuant's values) and server/tests/reconciliation/futures/results/.

suppressPackageStartupMessages({ library(GaussQuant); library(QuantLib); library(rmql); library(jsonlite); library(dplyr); library(purrr) })

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/futures/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
inp <- fromJSON(file.path(lab, "server/data/futures_demo/inputs.json"))
b <- inp$basket
valuation <- inp$valuation_date
delivery <- inp$delivery_date
carry_t <- as.numeric(as.Date(delivery) - as.Date(valuation)) / 365

# ---- GaussQuant: the manuscript's code, with the fictitious prices in place of bb_price ---------------------
GaussQuant::set_eval_date_GQL(valuation)
dc <- QuantLib::Actual365Fixed()
gq_bond <- function(issue_date, maturity_date, coupon_pct, issue_date_override = NULL) GaussQuant::fixed_rate_bond_GQL(
  issue_date = issue_date, maturity_date = maturity_date, coupon_rate = coupon_pct / 100, face_amount = 100, settlement_days = 0L,
  frequency = GaussQuant::period_months_GQL(6), calendar = QuantLib::Japan(), accrual_day_counter = dc,
  payment_convention = "Following", schedule_convention = "Unadjusted", maturity_convention = "Unadjusted")
gq_bonds <- pmap(list(b$issue_date, b$maturity_date, b$coupon_pct), gq_bond)
accrued <- function(bond, d) bond$accruedAmount(GaussQuant::date_GQL(d))
coupon_income <- function(bond) {
  GaussQuant::bond_cashflow_table_GQL(bond) |> mutate(date = as.Date(date)) |>
    filter(date > as.Date(valuation), date <= as.Date(delivery)) |> summarise(v = sum(amount, na.rm = TRUE)) |> pull(v)
}
basis_table <- function(price, yield, futures_price, funding) {
  tibble(issue = b$issue,
         accrued_start = map_dbl(gq_bonds, accrued, valuation), accrued_end = map_dbl(gq_bonds, accrued, delivery),
         coupon_income = map_dbl(gq_bonds, coupon_income)) |>
    mutate(price = price, yield = yield, dirty = price + accrued_start, invoice = futures_price * b$conversion_factor,
           gross_basis = price - invoice, funding_cost = dirty * funding * carry_t,
           carry = coupon_income + accrued_end - accrued_start - funding_cost, net_basis = gross_basis - carry,
           implied_repo = (invoice + accrued_end + coupon_income - dirty) / dirty / carry_t,
           ctd = net_basis == min(net_basis))
}
gq_yield <- map2_dbl(gq_bonds, b$fictitious_price, \(x, p) GaussQuant::bond_yield_from_price_GQL(
  bond = x, clean_price = p, day_counter = dc, compounding = "Compounded", frequency = "Semiannual", settlement_date = valuation))
gq_duration <- map2_dbl(gq_bonds, gq_yield, \(x, y) GaussQuant::bond_duration_GQL(bond = x, ytm = y, day_counter = dc, compounding = "Compounded", frequency = "Semiannual"))
gq_dv01 <- map2_dbl(gq_bonds, gq_yield, \(x, y) GaussQuant::bond_dv01_GQL(bond = x, ytm = y, day_counter = dc, compounding = "Compounded", frequency = "Semiannual"))
current <- basis_table(b$fictitious_price, gq_yield, inp$futures_price, inp$funding_rate) |>
  mutate(duration = gq_duration, dv01 = gq_dv01)
ctd <- which(current$ctd)
current_futures_bpv <- GaussQuant::futures_bpv_GQL(current$dv01[ctd], b$conversion_factor[ctd])

standard <- gq_bond(valuation, inp$stress$standard_maturity, 100 * inp$stress$standard_coupon)
stress_y <- inp$stress$long_yield
stress_futures <- GaussQuant::bond_clean_price_from_yield_safe_GQL(bond = standard, yield_rate = stress_y, day_counter = dc,
  compounding = "Compounded", frequency = "Semiannual", settlement_date = GaussQuant::date_GQL(valuation))
stress_price <- map_dbl(gq_bonds, \(x) GaussQuant::bond_clean_price_from_yield_safe_GQL(bond = x, yield_rate = stress_y, day_counter = dc,
  compounding = "Compounded", frequency = "Semiannual", settlement_date = GaussQuant::date_GQL(valuation)))
stress <- basis_table(stress_price, rep(stress_y, nrow(b)), stress_futures, inp$stress$funding_rate) |>
  mutate(duration = map_dbl(gq_bonds, \(x) GaussQuant::bond_duration_GQL(bond = x, ytm = stress_y, day_counter = dc, compounding = "Compounded", frequency = "Semiannual")),
         dv01 = map_dbl(gq_bonds, \(x) GaussQuant::bond_dv01_GQL(bond = x, ytm = stress_y, day_counter = dc, compounding = "Compounded", frequency = "Semiannual")))
sctd <- which(stress$ctd)
stress_futures_bpv <- GaussQuant::futures_bpv_GQL(stress$dv01[sctd], b$conversion_factor[sctd])

# ---- rmql ---------------------------------------------------------------------------------------
rb <- function(issue_date, maturity_date, coupon_pct) rmql::create_fixed_rate_bond(
  settlement_days = 0L, face_amount = 100, effective_date = issue_date, termination_date = maturity_date, tenor = "6M", calendar = "japan",
  convention = "unadjusted", termination_convention = "unadjusted", rule = "backward", end_of_month = FALSE,
  coupon_rate = coupon_pct / 100, day_count = "actual_365_fixed", payment_convention = "following", redemption = 100)
r_bonds <- pmap(list(b$issue_date, b$maturity_date, b$coupon_pct), rb)
r_yield <- map2_dbl(r_bonds, b$fictitious_price, \(x, p) rmql::compute_yield_from_price(x, p, "clean", "actual_365_fixed", "compounded", 2L, valuation, accuracy = 1e-8)) # QuantLib Bond::yield default accuracy, as GaussQuant uses
r_dur <- map2_dbl(r_bonds, r_yield, \(x, y) rmql::compute_duration(x, y, "actual_365_fixed", "compounded", 2L, valuation, "modified"))
r_dv01 <- map2_dbl(r_bonds, r_yield, \(x, y) (rmql::compute_clean_price(x, y - 1e-4, "actual_365_fixed", "compounded", 2L, valuation) -
                                                rmql::compute_clean_price(x, y + 1e-4, "actual_365_fixed", "compounded", 2L, valuation)) / 2)
r_bpv <- map2_dbl(r_bonds, r_yield, \(x, y) rmql::compute_basis_point_value(x, y, "actual_365_fixed", "compounded", 2L, valuation))
r_cur <- rmql::compute_future_basket(r_bonds, b$fictitious_price, inp$futures_price, b$conversion_factor, inp$funding_rate, valuation, delivery)
r_std <- rb(valuation, inp$stress$standard_maturity, 100 * inp$stress$standard_coupon)
r_stress_futures <- rmql::compute_clean_price(r_std, stress_y, "actual_365_fixed", "compounded", 2L, valuation)
r_stress_price <- map_dbl(r_bonds, \(x) rmql::compute_clean_price(x, stress_y, "actual_365_fixed", "compounded", 2L, valuation))
r_str <- rmql::compute_future_basket(r_bonds, r_stress_price, r_stress_futures, b$conversion_factor, inp$stress$funding_rate, valuation, delivery)
r_str_dur <- map_dbl(r_bonds, \(x) rmql::compute_duration(x, stress_y, "actual_365_fixed", "compounded", 2L, valuation, "modified"))
r_str_dv01 <- map_dbl(r_bonds, \(x) (rmql::compute_clean_price(x, stress_y - 1e-4, "actual_365_fixed", "compounded", 2L, valuation) -
                                       rmql::compute_clean_price(x, stress_y + 1e-4, "actual_365_fixed", "compounded", 2L, valuation)) / 2)

# ---- Baseline: the manuscript's own results (price-independent values and the stress scenario) ----------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]

cmp <- function(item, api, ref, tol) data.frame(item = item, n = length(api), max_abs_diff = max(abs(api - ref)), tolerance = tol, pass = max(abs(api - ref)) <= tol)
rows <- rbind(
  cmp("経過利子（評価日）RFM−GQ", r_cur$accrued_start, current$accrued_start, 1e-12),
  cmp("経過利子（受渡日）RFM−GQ", r_cur$accrued_end, current$accrued_end, 1e-12),
  cmp("保有期間のクーポン RFM−GQ", r_cur$coupon_income, current$coupon_income, 1e-12),
  cmp("複利利回り（架空価格）RFM−GQ", r_yield, current$yield, 1e-10),
  cmp("修正デュレーション RFM−GQ", r_dur, current$duration, 1e-8),
  cmp("DV01（±1bpの中心差分）RFM−GQ", r_dv01, current$dv01, 1e-10),
  cmp("Gross Basis RFM−GQ", r_cur$gross_basis, current$gross_basis, 1e-10),
  cmp("Carry RFM−GQ", r_cur$carry, current$carry, 1e-10),
  cmp("Net Basis RFM−GQ", r_cur$net_basis, current$net_basis, 1e-10),
  cmp("Implied Repo RFM−GQ", r_cur$implied_repo, current$implied_repo, 1e-10),
  cmp("CTD（一致なら0）", as.numeric(which(r_cur$ctd)), as.numeric(ctd), 0),
  cmp("先物BPV = CTDのDV01 / CF RFM−GQ", r_dv01[which(r_cur$ctd)] / b$conversion_factor[which(r_cur$ctd)], current_futures_bpv, 1e-10),
  cmp("ストレス：先物価格 RFM−GQ", r_stress_futures, stress_futures, 1e-10),
  cmp("ストレス：現物価格 RFM−GQ", r_stress_price, stress$price, 1e-10),
  cmp("ストレス：Net Basis RFM−GQ", r_str$net_basis, stress$net_basis, 1e-10),
  cmp("ストレス：Implied Repo RFM−GQ", r_str$implied_repo, stress$implied_repo, 1e-10),
  cmp("ストレス：修正デュレーション RFM−GQ", r_str_dur, stress$duration, 1e-8),
  cmp("ストレス：先物BPV RFM−GQ", r_str_dv01[which(r_str$ctd)] / b$conversion_factor[which(r_str$ctd)], stress_futures_bpv, 1e-10),
  # against the manuscript's own run (price-independent, or stress = no market prices)
  cmp("経過利子（評価日）RFM−原稿", r_cur$accrued_start, bv(paste0("future.accrued_start.", b$issue)), 1e-10),
  cmp("経過利子（受渡日）RFM−原稿", r_cur$accrued_end, bv(paste0("future.accrued_end.", b$issue)), 1e-10),
  cmp("保有期間のクーポン RFM−原稿", r_cur$coupon_income, bv(paste0("future.coupon_income.", b$issue)), 1e-10),
  cmp("ストレス：先物価格 RFM−原稿", r_stress_futures, bv("stress.futures_price"), 1e-10),
  cmp("ストレス：現物価格 RFM−原稿", r_stress_price, bv(paste0("stress.price.", b$issue)), 1e-10),
  cmp("ストレス：Gross Basis RFM−原稿", r_str$gross_basis, bv(paste0("stress.gross_basis.", b$issue)), 1e-10),
  cmp("ストレス：Net Basis RFM−原稿", r_str$net_basis, bv(paste0("stress.net_basis.", b$issue)), 1e-10),
  cmp("ストレス：Implied Repo（%）RFM−原稿", 100 * r_str$implied_repo, bv(paste0("stress.implied_repo_pct.", b$issue)), 1e-8),
  cmp("ストレス：CTD RFM−原稿", b$issue[which(r_str$ctd)], bv("stress.ctd_issue"), 0)
)
rownames(rows) <- NULL
options(width = 200)
print(rows, digits = 3)
cat("CTD current:", b$issue[ctd], " stress:", b$issue[sctd], " analytic BPV (QL) of CTD:", r_bpv[ctd], " DV01:", r_dv01[ctd], "\n")
utils::write.csv(rows, file.path(out_dir, "futures_diffs.csv"), row.names = FALSE)
golden <- list(
  inputs_file = "server/data/futures_demo/inputs.json", engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib 1.42"),
  current = transform(as.data.frame(current), ctd = ctd), current_futures_bpv = current_futures_bpv, current_ctd_issue = b$issue[ctd],
  stress = transform(as.data.frame(stress), ctd = ctd), stress_futures_price = stress_futures, stress_futures_bpv = stress_futures_bpv,
  stress_ctd_issue = b$issue[sctd]
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE), file.path(lab, "server/tests/golden/futures_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), golden$engine, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass))
