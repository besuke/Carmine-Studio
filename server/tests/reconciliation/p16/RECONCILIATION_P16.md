# Reconciliation of chapter 13 (lookback options, convertible bonds, MSCB)

Run 2026-11-22 with rmql 0.5.0 and QuantLib 1.42 (R package). Synthetic inputs. `npm run reconcile:p16`; the tables are in `results/`.

| Group | Check | Cases | Largest difference | Tolerance | Result | Note |
|---|---|---:|---:|---:|---|---|
| lookback | continuous monitoring, the API against QuantLib 1.42 (floating and fixed, call and put) | 32 | 5.21e-13 | 1e-09 | pass |  |
| lookback | fixed-strike call = floating-strike put + S e^{-qT} - K e^{-rT} | 1 | 1.12e-16 | 1e-12 | pass |  |
| lookback | discrete monitoring at every step: the error halves when the steps are four times (ratio 0.5 +- 0.05) | 2 | 0.0113 | 0.05 | pass |  |
| lookback | discrete monitoring: the extrapolation in 1/sqrt(steps) against the closed form | 2 | 0.0016 | 0.005 | pass |  |
| lookback | monthly monitoring: the tree (extrapolated from 132 and 396 steps) against an independent Monte Carlo, in price units (60,000 antithetic pairs) | 2 | 0.0399 | 0.1 | pass | the standard error of the Monte Carlo is 0.033 |
| convertible | the API against QuantLib 1.42 BinomialCRRConvertibleEngine (European, American, Bermudan; calls, puts, clean prices) | 24 | 3.16e-12 | 1e-09 | pass | the cases where QuantLib's time grid ends below the end are left out (rmql's specification, 4) |
| convertible | European conversion without coupon or credit spread = F e^{-rT} + ratio call(S, F / ratio) (300 steps) | 1 | 9.25e-05 | 0.003 | pass | the error of a tree of 300 steps |
| mscb | a conversion price reset between equal limits = a fixed ratio F / K | 3 | 0 | 1e-10 | pass |  |
| mscb | a conversion price reset at conversion: the closed form of the European case (300 steps) | 3 | 0.000123 | 0.003 | pass | the error of a tree of 300 steps |
| mscb | above lower / ratio an American holder converts at once for F / ratio | 1 | 0 | 1e-09 | pass | flagged by the API |
| mscb | a conversion price carried with no reset date = a fixed ratio (scaled lattice and grid) | 2 | 0 | 1e-10 | pass |  |
| mscb | rule both, one reset, European conversion: the closed form F e^{-rT} + e^{-r tau} (F / alpha) call(1, alpha, T - tau) (400 steps; the grid with 80 prices) | 2 | 0.000154 | 0.003 | pass | the error of a tree of 400 steps |
| mscb | downward_only, four resets, American: the grid of 80 prices against the scaled lattice | 1 | 0.000944 | 0.002 | pass | the two interpolations differ; see rmql's specification, 6 |

The model of the page is `server/R/lookback_model.R` and `convertible_model.R` (the API functions are called as the server calls them); the reference of each check is in its name.
QuantLib's convertible engine does not allow an American conversion at maturity for the numbers of steps at which its time grid ends one unit in the last place below the end; rmql does, and those cases are left out (rmql's `docs/spec_lookback_convertible.md`, 4).
