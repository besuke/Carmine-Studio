# Reconcile the deterministic cash-flow chapter (Coral Book II-1): GaussQuant / QuantLib 1.42 running the
# manuscript's code against the page's own model (server/R/bond_model.R, rmql), and that model against the
# manuscript's own results (rmql comparison/baseline/lagrange_values.csv). The inputs are the manuscript's.
#
#   npm run reconcile:bond
#
# Writes server/tests/golden/bond_golden.json (GaussQuant's values) and server/tests/reconciliation/bond/results/.

suppressPackageStartupMessages({
  library(GaussQuant)
  library(QuantLib)
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/bond/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/bond_model.R"))
api <- bond_compute(list())
b <- api$bond

# ---- GaussQuant: the manuscript's code (II-1.2.4, II-1.3–1.8) -----------------------------------------------------
tonar <- GaussQuant::tonar_curve_benchmark_GQL()$validation$quote_repricing

jp_calendar <- QuantLib::Japan()
dc_30 <- GaussQuant::day_counter_GQL("Thirty360", convention = "BondBasis")
cmpd_compounded <- QuantLib::Compounding_Compounded_get()
freq_semiannual <- QuantLib::Frequency_Semiannual_get()
trade_date <- GaussQuant::date_GQL("2022-03-30")
GaussQuant::set_eval_date_GQL(trade_date)
settlement_date_chr <- as.character(GaussQuant::advance_days_GQL(calendar_obj = jp_calendar, date_obj = trade_date, n_days = 2L))
bond_obj <- GaussQuant::fixed_rate_bond_GQL(
  issue_date = "2022-04-01", maturity_date = "2062-04-01", face_amount = 100, coupon_rate = 0.075, settlement_days = 2L,
  calendar = jp_calendar, accrual_day_counter = dc_30, payment_convention = "Unadjusted", schedule_convention = "Unadjusted",
  maturity_convention = "Unadjusted", date_generation = "Backward", end_of_month = FALSE, schedule_frequency = GaussQuant::period_months_GQL(6))
gq_cashflows <- GaussQuant::bond_cashflow_table_GQL(bond = bond_obj)
yen_years <- GaussQuant::bond_year_fraction_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01")
yen_price <- GaussQuant::bond_price_from_simple_rate_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01", coupon_rate = 7.5,
                                                              simple_rate = 6.515, redemption = 100)
yen_simple_back <- GaussQuant::bond_simple_rate_from_price_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01", coupon_rate = 7.5,
                                                                    price = yen_price, redemption = 100)
yen_compound <- GaussQuant::bond_compound_yield_from_price_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01", coupon_rate = 7.5,
  price = yen_price, redemption = 100, coupon_frequency = 2, compound_frequency = 2)
yen_compound_price <- GaussQuant::bond_price_from_compound_yield_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01", coupon_rate = 7.5,
  compound_yield = yen_compound, redemption = 100, coupon_frequency = 2, compound_frequency = 2)
flat_yield_handle <- GaussQuant::bond_flat_forward_handle_GQL(settlement_date = settlement_date_chr, rate = yen_compound / 100, day_counter = dc_30,
                                                              compounding = cmpd_compounded, frequency = freq_semiannual)
QuantLib::Instrument_setPricingEngine(bond_obj, QuantLib::DiscountingBondEngine(flat_yield_handle))
flat_dirty_price <- QuantLib::Instrument_NPV(bond_obj)
zspread_npv <- GaussQuant::bond_npv_with_zspread_GQL(bond = bond_obj, base_curve_handle = flat_yield_handle, z_spread = 50 / 10000,
  compounding = cmpd_compounded, frequency = freq_semiannual, day_counter = dc_30)$npv
yen_risk <- GaussQuant::bond_risk_from_compound_yield_YEN_GQL(start_date = settlement_date_chr, end_date = "2062-04-01", coupon_rate = 7.5,
  compound_yield = yen_compound, redemption = 100, coupon_frequency = 2, compound_frequency = 2, accrued_interest = 0)
GaussQuant::set_eval_date_GQL(trade_date)
gq_yield <- 100 * GaussQuant::bond_yield_from_price_GQL(bond = bond_obj, clean_price = yen_price, day_counter = dc_30,
                                                        compounding = cmpd_compounded, frequency = freq_semiannual)

# II-1.2.5 as the manuscript computes it (dplyr), for the default shapes
manuscript_shapes <- tidyr::crossing(curve_shape = c("順イールド", "逆イールド"), maturity = 1:10) |>
  group_by(curve_shape) |>
  mutate(
    spot_rate = if_else(curve_shape == "順イールド", 0.01 + 0.002 * maturity, 0.035 - 0.0015 * maturity),
    discount_factor = (1 + spot_rate)^(-maturity),
    forward_rate = lag(discount_factor, default = 1) / discount_factor - 1,
    par_rate = (1 - discount_factor) / cumsum(discount_factor)
  ) |>
  ungroup()
api_shapes <- api$shapes |> arrange(curve_shape, maturity)
manuscript_shapes <- manuscript_shapes |> arrange(curve_shape, maturity)

# ---- comparisons -----------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))),
                                            tolerance = NA_real_, pass = NA, note = note)
solver <- function(k) b$solvers$yield_pct[k]
api_flows <- b$cashflows
flow_keys <- sprintf("%03d", seq_len(nrow(api_flows)))
YEN_NOTE <- "日本の計算規則の切り捨て（単価3桁・利回り7桁）を含め同じ値"
rows <- bind_rows(
  cmp("TONAR：ピラー日（日数）", as.numeric(as.Date(api$tonar$pillar_date)), as.numeric(tonar$pillar_date), 0),
  cmp("TONAR：割引係数", api$tonar$discount_factor, tonar$discount_factor, 1e-14),
  cmp("TONAR：連続複利ゼロ", api$tonar$zero_rate, tonar$zero_rate, 1e-14),
  cmp("TONAR：瞬間フォワード", api$tonar$inst_fwd_rate, tonar$inst_fwd_rate, 1e-11),
  cmp("模式図：スポット・割引係数・パー・フォワード（40点）",
      c(api_shapes$spot_rate, api_shapes$discount_factor, api_shapes$par_rate, api_shapes$forward_rate),
      c(manuscript_shapes$spot_rate, manuscript_shapes$discount_factor, manuscript_shapes$par_rate, manuscript_shapes$forward_rate), 1e-15,
      "dplyr の lag・cumsum と R の基本関数で演算順序が異なり、最下位ビットが違う"),
  cmp("受渡日（日数）", as.numeric(as.Date(b$settlement_date)), as.numeric(as.Date(settlement_date_chr)), 0),
  cmp("キャッシュフローの支払日（81件）", as.numeric(as.Date(api_flows$payment_date)), as.numeric(as.Date(gq_cashflows$date)), 0),
  cmp("キャッシュフローの金額（81件）", api_flows$amount, gq_cashflows$amount, 1e-12),
  cmp("残存年数", b$remaining_years, yen_years, 0),
  cmp("単利→単価", b$clean_price, yen_price, 0, YEN_NOTE),
  cmp("単価→単利", b$simple_from_price, yen_simple_back, 0, YEN_NOTE),
  cmp("単価→複利利回り", b$compound_yield_pct, yen_compound, 0, YEN_NOTE),
  cmp("複利利回り→単価", b$compound_price, yen_compound_price, 0, YEN_NOTE),
  cmp("フラットイールドのダーティ価格", b$flat_dirty_price, flat_dirty_price, 1e-11),
  cmp("Zスプレッド 50bp の NPV", b$z_spread_npv, zspread_npv, 1e-11),
  cmp("NPV から逆算した Zスプレッド（bp）", b$z_spread_back_bp, 50, 1e-6),
  cmp("BPV（円）RFM − GQ", b$risk$bpv_yen, yen_risk$bpv_yen, 1e-14),
  cmp("修正デュレーション RFM − GQ", b$risk$modified_duration, yen_risk$modified_duration, 1e-12),
  cmp("コンベクシティ RFM − GQ", b$risk$convexity, yen_risk$convexity, 1e-10),
  cmp("解析式の単価 − RFM", b$formula$price, b$risk$price, 1e-11),
  cmp("解析式の dP/dY − RFM", b$formula$dp_dy_pct, b$risk$dp_dy_pct, 1e-11),
  cmp("解析式の d²P/dY² − RFM", b$formula$d2p_dy2_pct, b$risk$d2p_dy2_pct, 1e-11),
  cmp("ニュートン法の利回り − 複利利回り（RFM、7桁で切り捨て）", solver(1), b$compound_yield_pct, 1e-7),
  cmp("二分法・Brent法・多項式求根法 − ニュートン法", solver(2:4), solver(1), 1e-9),
  cmp("QuantLib 方式の利回り（精度 1e-8）RFM − GQ", solver(6), gq_yield, 1e-12),
  # against the manuscript's own run
  cmp("原稿：受渡日", as.numeric(as.Date(b$settlement_date)), bv("bond.settlement"), 0),
  cmp("原稿：キャッシュフローの金額", api_flows$amount, bv(paste0("bond.cashflow.amount.", flow_keys)), 1e-12),
  cmp("原稿：キャッシュフローの支払日", as.numeric(as.Date(api_flows$payment_date)), bv(paste0("bond.cashflow.date.", flow_keys)), 0),
  cmp("原稿：残存年数", b$remaining_years, bv("yen.remaining_years"), 0),
  cmp("原稿：単利→単価", b$clean_price, bv("yen.simple_price"), 0),
  cmp("原稿：単価→単利", b$simple_from_price, bv("yen.simple_rate_pct"), 0),
  cmp("原稿：複利利回り", b$compound_yield_pct, bv("yen.compound_yield_pct"), 0),
  cmp("原稿：複利利回り→単価", b$compound_price, bv("yen.compound_price"), 0),
  cmp("原稿：フラットイールドのダーティ価格", b$flat_dirty_price, bv("bond.flat_dirty_price"), 1e-11),
  cmp("原稿：Zスプレッド 50bp の NPV", b$z_spread_npv, bv("bond.z_spread_npv"), 1e-11),
  cmp("原稿：BPV（円）", b$risk$bpv_yen, bv("yen.bpv_yen"), 1e-14),
  cmp("原稿：修正デュレーション", b$risk$modified_duration, bv("yen.modified_duration"), 1e-12),
  cmp("原稿：コンベクシティ", b$risk$convexity, bv("yen.convexity"), 1e-10),
  cmp("原稿：QuantLib 方式の利回り", solver(6), bv("bond.yield_pct"), 1e-12),
  info("計算時間（μs）", b$solvers$average_us, 0, "判定しない：環境で変わる。ページには API の実測値を出す")
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> distinct(note, .keep_all = TRUE) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "bond_diffs.csv"), row.names = FALSE)

golden <- list(
  engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib 1.42"),
  tonar = as.data.frame(tonar |> mutate(pillar_date = format(pillar_date))),
  settlement = settlement_date_chr, cashflows = as.data.frame(gq_cashflows |> mutate(date = format(as.Date(date)))),
  remaining_years = yen_years, clean_price = yen_price, simple_from_price = yen_simple_back, compound_yield_pct = yen_compound,
  compound_price = yen_compound_price, flat_dirty_price = flat_dirty_price, z_spread_npv = zspread_npv,
  risk = as.list(yen_risk), yield_quantlib_pct = gq_yield
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/bond_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), golden$engine, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
