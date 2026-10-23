# Arrears risk: backtest results

## Data

Synthetic rent-payment history for 60 tenancies (30 at Acme Property Group, Auckland; 30 at Kestrel Lettings, Manchester and Leeds), one row per tenancy per month from 2024-10 to 2026-09. Each tenancy is generated from a hidden payment profile (recorded in `data/risk/history.json`) with a fixed seed. A month counts as arrears when the payment lands 30+ days late, is missed, or the running shortfall reaches one month's rent.

Profile counts: chronic_late 7, deteriorating 5, occasional_late 12, partial_payer 6, reliable 23, seasonal 4, shock 3.

## Method

Ten features are computed as of a cutoff month (defined in `server/ml/README.md`). Training rows come from cutoffs 2025-09, 2025-12, 2026-03 with the label "any arrears in the next three months": 159 rows, 20 positive. The backtest cutoff is 2026-06 and the label is any arrears in 2026-07 to 2026-09, which the model never sees: 60 tenancies, 11 positive.

The shipped model is logistic regression on standardised features (balanced class weights, C=1.0). Gradient boosting (100 trees, depth 2) is a comparison; the rule flags a tenancy when it paid late in two of the last three months or has any prior arrears; a random ranking has an expected AUC of 0.5.

## Backtest (cutoff 2026-06, labels 2026-07 to 2026-09)

| Model | AUC | P@10 | R@10 | P@15 | R@15 | Brier |
|---|---|---|---|---|---|---|
| Logistic regression (shipped) | 0.894 | 0.90 | 0.82 | 0.60 | 0.82 | 0.111 |
| Gradient boosting | 0.875 | 0.90 | 0.82 | 0.60 | 0.82 | 0.078 |
| Rule: late 2 of last 3 or prior arrears | 0.787 | 0.60 | 0.55 | 0.47 | 0.64 | 0.233 |
| Random | 0.500 | - | - | - | - | - |

The rule flags 21 tenancies with precision 0.43 and recall 0.82. Top-k lists break score ties in roster order, so the rule's top-k figures depend on that order. The Brier score for the rule treats its 1/0 flag as a probability.

## Calibration (logistic regression)

| Predicted probability | Count | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.2 | 40 | 0.05 | 0.05 |
| 0.2-0.4 | 3 | 0.23 | 0.00 |
| 0.4-0.6 | 3 | 0.51 | 0.00 |
| 0.6-0.8 | 1 | 0.77 | 0.00 |
| 0.8-1.0 | 13 | 0.96 | 0.69 |

With 60 backtest rows the bins hold a handful of tenancies each, so the observed rates carry wide uncertainty (one tenancy moves a bin of five by 20 points). The table shows whether the probabilities sit in the right region, not that they are calibrated to the second decimal; the bands below are the intended way to read the scores.

## Risk bands

High >= 0.5, medium >= 0.25, low below, applied to the logistic-regression probability.

| Scoring point | High | Medium | Low |
|---|---|---|---|
| Backtest (2026-06) | 16 | 2 | 42 |
| Demo (2026-09) | 19 | 3 | 38 |

## Model weights

| Feature | Coefficient (standardised) |
|---|---|
| late_share_6 | +0.768 |
| avg_days_late_6 | +1.061 |
| late_trend | +0.819 |
| partial_count_6 | +0.146 |
| missed_count_12 | +0.829 |
| max_days_late_12 | -0.532 |
| prior_arrears | +0.255 |
| tenancy_months | -0.615 |
| rent_ratio | +0.030 |
| balance_ratio | +0.833 |

Intercept -1.523. Weights, means and scales are in `data/risk/model.json`; the Node server reproduces the probabilities from them.
