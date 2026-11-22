# Reconciliation of chapter 14 (MBS and the PRDC target redemption)

Run 2026-11-22 with rmql 0.5.0. Synthetic inputs. `npm run reconcile:mbs-prdc`; the MBS table is in `results/mbs_recursion.csv`.

| Group | Check | Cases | Largest difference | Tolerance | Result | Note |
|---|---|---:|---:|---:|---|---|
| mbs | the balance and the cash flows of the API against the recursion of the rule (largest difference) | 12 | 5.37e-13 | 1e-09 | pass |  |
| mbs | the prepayment speed CPR against the rule | 12 | 0 | 1e-12 | pass |  |
| mbs | the price of a path against discounting the cash flows exp(-sum r/12) | 12 | 2.42e-13 | 1e-09 | pass |  |
| mbs | the weighted average life against sum (m / 12) principal / sum principal | 12 | 3.2e-14 | 1e-09 | pass |  |
| mbs | no prepayment (PSA 0): the balance against the closed form of the annuity | 1 | 4.94e-13 | 1e-09 | pass |  |
| mbs | no prepayment (PSA 0): the prepaid principal is zero | 1 | 0 | 0 | pass |  |
| mbs | the OAS reprices the assumed price when each path is discounted here (the mean over 50 Hull-White paths) | 1 | 5.23e-11 | 1e-06 | pass |  |
| mbs | the mean price of the API against the mean over the paths discounted here | 1 | 1.42e-14 | 1e-09 | pass |  |
| prdc | no target and no knock-out: the Monte Carlo value against the closed form, in standard errors (20,000 paths, 3 steps a year) | 1 | 0.277 | 4 | pass |  |
| prdc | a target that cannot be reached = no target (the same paths) | 1 | 0 | 1e-09 | pass |  |
| prdc | a knock-out level that cannot be hit = no knock-out (the same paths); its probability is zero | 1 | 0 | 1e-09 | pass |  |
| prdc | the probabilities of the end are in [0, 1], and the survival is non-increasing and ends at 1 - their sum | 1 | 0 | 1e-12 | pass |  |
| prdc | the expected life is between 1 year and the maturity | 1 | 0 | 0 | pass |  |
| prdc | a lower target ends earlier: the expected life of target 5% is shorter than that of 40% | 1 | 0 | 0 | pass |  |

**Not checked against an independent simulation**: the logic of the target (the coupon of the date that reaches it, the make-whole) and of the knock-out (its observation dates). The checks above are identities (a state that cannot occur is no state) and the consistency of the probabilities, so a mistake in that logic that keeps those would not be seen here.
