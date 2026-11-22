# Reconciliation of chapter 11.5 (a network that learned the Black-Scholes call price)

Run 2026-11-22 with rmql 0.5.0. Synthetic inputs. `npm run reconcile:bs-surrogate`.

The network is an approximation; its error against the closed form is the *result* (in `server/data/cnn/bs_surrogate_results.json` and on the page), not something to reconcile. What is checked here is the machinery that produces and compares the numbers.

| Check | Cases | Largest difference | Tolerance | Result | Note |
|---|---:|---:|---:|---|---|
| rmql's closed form against the Black-Scholes formula written here: the price (largest absolute difference; a relative difference is meaningless for the deep out-of-the-money prices of about 1e-13) | 500 | 4.44e-16 | 1e-12 | pass |  |
| rmql's closed form against the Black-Scholes formula written here: the delta (largest absolute difference) | 500 | 6.66e-16 | 1e-10 | pass |  |
| the server's forward pass against a per-row forward written here (largest absolute difference) | 200 | 3.05e-16 | 1e-12 | pass |  |
| the derivative with respect to the five inputs (backward pass) against central differences (largest difference / largest entry) | 100 | 3.93e-08 | 1e-06 | pass |  |
| the delta of the network against a central difference of its price in the spot (largest absolute difference) | 50 | 2.73e-08 | 1e-06 | pass |  |
| homogeneity: scaling S and K by 7 scales the network's price by 7 (largest relative difference) | 50 | 1.46e-14 | 1e-12 | pass |  |
| fresh points inside the range: the RMSE of the price and of the delta are within a factor 1.5 of those recorded at training | 2 | 0.0351 | 0.5 | pass | price RMSE 3.24e-03 (recorded 3.27e-03), delta RMSE 4.57e-02 (recorded 4.73e-02) |
