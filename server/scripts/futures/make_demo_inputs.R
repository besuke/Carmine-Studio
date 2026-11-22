# Fictitious inputs for the JGB futures chapter (Coral Book II-2.6–2.7).
#
#   node ui/scripts/run-r.mjs server/scripts/futures/make_demo_inputs.R
#
# The manuscript's deliverable-bond prices are Bloomberg prices ("BB価格", placeholders until 日本相互証券's
# figures); the repository is public, so they are not copied. Kept from the manuscript: the deliverable basket
# (issues 373–383, issue and maturity dates, coupons), the conversion factors (published by the exchange), the
# valuation and delivery dates, and the funding rate 1.23%. Replaced by fictitious values:
#   prices        : each bond priced at the yield of the manuscript's illustrative "Current market" curve of II-2.7.2
#                   (0.25Y 1.23%, 2Y 1.55%, 5Y 2.20%, 7Y 2.55%, 10Y 2.90%), linear in years to maturity,
#                   semiannual compounding, Actual/365 Fixed, rounded to 3 decimals
#   futures price : the smallest (price - carry) / CF over the basket, less 0.10, rounded to 2 decimals
# Writes server/data/futures_demo/inputs.json. rmql computes the prices, as the API does.

suppressPackageStartupMessages({ library(rmql); library(jsonlite) })
out_dir <- "C:/AnalyticFin/Projects/Carmine-Studio/server/data/futures_demo"
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

valuation <- as.Date("2026-09-10")
delivery <- as.Date("2026-12-20")
funding <- 0.0123
basket <- data.frame(
  issue = 373:383,
  issue_date = as.Date(c("2023-12-20", "2024-03-20", "2024-06-20", "2024-09-20", "2024-12-20", "2025-03-20", "2025-06-20", "2025-09-20", "2025-12-20", "2026-03-20", "2026-06-20")),
  coupon_pct = c(0.6, 0.8, 1.1, 0.9, 1.2, 1.4, 1.5, 1.7, 2.1, 2.4, 2.7),
  maturity_date = as.Date(c("2033-12-20", "2034-03-20", "2034-06-20", "2034-09-20", "2034-12-20", "2035-03-20", "2035-06-20", "2035-09-20", "2035-12-20", "2036-03-20", "2036-06-20")),
  conversion_factor = c(0.695006, 0.697881, 0.707520, 0.687561, 0.698533, 0.704059, 0.703762, 0.710535, 0.731806, 0.747221, 0.763657)
)
curve <- data.frame(tenor_years = c(0.25, 2, 5, 7, 10), yield_pct = c(1.23, 1.55, 2.20, 2.55, 2.90))

jgb <- function(issue_date, maturity_date, coupon_pct) {
  rmql::create_fixed_rate_bond(
    settlement_days = 0L, face_amount = 100, effective_date = issue_date, termination_date = maturity_date, tenor = "6M",
    calendar = "japan", convention = "unadjusted", termination_convention = "unadjusted", rule = "backward", end_of_month = FALSE,
    coupon_rate = coupon_pct / 100, day_count = "actual_365_fixed", payment_convention = "following", redemption = 100
  )
}
years <- as.numeric(basket$maturity_date - valuation) / 365
basket$curve_yield_pct <- stats::approx(curve$tenor_years, curve$yield_pct, xout = years)$y
basket$fictitious_price <- vapply(seq_len(nrow(basket)), function(i) {
  b <- jgb(basket$issue_date[i], basket$maturity_date[i], basket$coupon_pct[i])
  round(rmql::compute_clean_price(b, basket$curve_yield_pct[i] / 100, "actual_365_fixed", "compounded", 2L, valuation), 3)
}, 0)
bonds <- lapply(seq_len(nrow(basket)), function(i) jgb(basket$issue_date[i], basket$maturity_date[i], basket$coupon_pct[i]))
# carry at an arbitrary futures price does not depend on it: price - carry is the forward clean value
probe <- rmql::compute_future_basket(bonds, basket$fictitious_price, 100, basket$conversion_factor, funding, valuation, delivery)
futures_price <- round(min((basket$fictitious_price - probe$carry) / basket$conversion_factor) - 0.10, 2)

inputs <- list(
  note = paste("教材用の架空の入力。受渡適格銘柄・CF・日付・Funding Rate は Coral Book II-2.6 と同じ。",
               "現物価格と先物価格は架空（原稿の BB 価格は使わない）。"),
  valuation_date = format(valuation), delivery_date = format(delivery), funding_rate = funding,
  futures_price = futures_price, current_curve = curve,
  basket = transform(basket, issue_date = format(issue_date), maturity_date = format(maturity_date)),
  stress = list(long_yield = 0.08, funding_rate = 0.09, standard_coupon = 0.06, standard_maturity = "2036-09-10",
                curve = data.frame(tenor_years = c(0.25, 2, 5, 7, 10), yield_pct = c(9.00, 8.80, 8.50, 8.25, 8.00))),
  generated_by = "server/scripts/futures/make_demo_inputs.R"
)
write(toJSON(inputs, auto_unbox = TRUE, digits = I(17), pretty = TRUE), file.path(out_dir, "inputs.json"))
print(basket[, c("issue", "coupon_pct", "maturity_date", "curve_yield_pct", "fictitious_price")])
cat("futures price (fictitious):", futures_price, "\n")
