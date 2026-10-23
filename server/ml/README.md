# Arrears-risk model

Predicts which tenancies are likely to fall 30 or more days behind on rent in the next three months. A small
Python script generates a seeded 24-month payment history for 60 tenancies, trains a logistic-regression model,
backtests it on a held-out final quarter and exports the weights to `data/risk/model.json`. The Node server
scores tenancies from that JSON with plain arithmetic, so Python is only needed to regenerate the data or
retrain.

## Data

- 60 tenancies: 30 at Acme Property Group (Auckland, NZD) and 30 at Kestrel Lettings (Manchester, Stockport
  and Leeds, GBP). The tenancies seeded in the app appear first in `data/risk/roster.json` with the same codes,
  names, rents and start dates.
- Months 2024-10 to 2026-09, rent due on the 1st. One row per tenancy-month with `rentDue`, `paidAmount`,
  `paidDate`, `daysLate` and `arrears30`. Tenancies that start inside the window have rows from their start month.
- `arrears30` is true when the month was paid 30+ days late, not paid at all (`daysLate` 60), or the running
  shortfall at the end of the month reaches one month's rent. Over-payments in later months reduce the shortfall.
- Each tenancy is simulated from a hidden profile that is recorded in `data/risk/history.json`: reliable,
  occasional_late, chronic_late, partial_payer, deteriorating, seasonal or shock. Shock tenancies pay reliably
  and then miss a month in the last four; earlier months give no warning.
- Ground truth for the backtest is any `arrears30` in 2026-07, 2026-08 or 2026-09.

## Features

All features are computed "as of" a cutoff month from the rows at or before it. "Last k" means the last k
existing rows and n is the number of rows available.

| # | Feature | Definition |
|---|---|---|
| 1 | `late_share_6` | count(daysLate > 0 in last 6) / min(6, n) |
| 2 | `avg_days_late_6` | mean daysLate over the last 6 |
| 3 | `late_trend` | mean daysLate of the last 3 minus mean of the up-to-3 rows before them; 0 when n < 4 |
| 4 | `partial_count_6` | months in the last 6 with 0 < paidAmount < rentDue |
| 5 | `missed_count_12` | months in the last 12 with paidAmount == 0 |
| 6 | `max_days_late_12` | max daysLate in the last 12 |
| 7 | `prior_arrears` | 1 if any arrears30 at or before the cutoff |
| 8 | `tenancy_months` | months since the lease start month, inclusive; min 1, capped at 60 |
| 9 | `rent_ratio` | monthly rent / monthly market rent (1.0 when no market rent) |
| 10 | `balance_ratio` | max(0, sum of rentDue - paidAmount up to the cutoff) / monthly rent |

Monthly rent is `round(weekly * 52 / 12, 2)`.

## Method

- Training rows: cutoffs 2025-09, 2025-12 and 2026-03; label = any arrears30 in the three months after the
  cutoff; tenancies with at least 3 rows at the cutoff. 159 rows, 20 positive.
- Backtest: cutoff 2026-06 (never trained on); label = the ground truth above. 60 tenancies, 11 positive.
- Shipped model: `StandardScaler` + `LogisticRegression(C=1.0, class_weight="balanced", solver="lbfgs")`.
  Probability = sigmoid(sum(coef_i * (x_i - mean_i) / scale_i) + intercept). The Node server reproduces the
  probabilities from `mean`, `scale`, `coef` and `intercept` in `model.json`; the per-feature contribution
  `coef_i * z_i` ranks the reasons shown to the user.
- Comparisons: `GradientBoostingClassifier(n_estimators=100, max_depth=2)`, a rule (flag when late in two of
  the last three months or any prior arrears) and a random ranking (expected AUC 0.5).
- Bands applied to the probability: high >= 0.5, medium >= 0.25, low below.

## Results (backtest, cutoff 2026-06, labels 2026-07 to 2026-09)

| Model | AUC | P@10 | R@10 | P@15 | R@15 | Brier |
|---|---|---|---|---|---|---|
| Logistic regression (shipped) | 0.894 | 0.90 | 0.82 | 0.60 | 0.82 | 0.111 |
| Gradient boosting | 0.875 | 0.90 | 0.82 | 0.60 | 0.82 | 0.078 |
| Rule | 0.787 | 0.60 | 0.55 | 0.47 | 0.64 | 0.233 |
| Random | 0.500 | - | - | - | - | - |

Bands at the demo scoring point (2026-09, all 24 months): 19 high, 3 medium, 38 low. The full report with the
calibration table is in `eval/results/risk.md`; every number in it is written by the script.

## Commands

Run from the repo root with the project venv (numpy and scikit-learn only; versions in `requirements.txt`).

```
D:\Portfolio\venvs\property-ml\Scripts\python.exe server\ml\arrears.py all        # generate, train, score
D:\Portfolio\venvs\property-ml\Scripts\python.exe server\ml\arrears.py generate   # roster.json, history.json
D:\Portfolio\venvs\property-ml\Scripts\python.exe server\ml\arrears.py train      # model.json, metrics.json, eval/results/risk.md
D:\Portfolio\venvs\property-ml\Scripts\python.exe server\ml\arrears.py score      # scores.json (backtest and demo)
```

The seed and the `generatedAt`/`trainedAt` stamp are fixed (`--seed`, `--stamp` override them), so re-running
writes byte-identical files. `train` asserts that probabilities recomputed from the exported JSON match
scikit-learn's `predict_proba` to 1e-9.

## Files

| Path | Contents |
|---|---|
| `data/risk/roster.json` | 60 tenancies with address, rents, start date |
| `data/risk/history.json` | seed, months, profiles, monthly rows, ground truth |
| `data/risk/model.json` | feature order, mean, scale, coef, intercept, bands, training and backtest summary |
| `data/risk/scores.json` | probabilities and features at the backtest (2026-06) and demo (2026-09) cutoffs |
| `data/risk/metrics.json` | all reported metrics, calibration bins, band counts, profile counts |
| `eval/results/risk.md` | readable backtest report |
