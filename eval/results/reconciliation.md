# Evaluation: rent reconciliation

Run on 2026-10-06 against the labelled synthetic statement `data/bank/2026-09-statement.csv` (50 lines, 9 planted exceptions, ground truth in `data/bank/truth.json`). Model: `gemini-flash-lite-latest`.

## How it is measured

- **Match accuracy:** a line is right when its type and target are right: the tenancy for rent and refunds, the job for contractor payments, the category otherwise. A line a person must decide (unknown or ambiguous) is right when it is held, or when it names the tenancy it really belongs to.
- **Exception detection:** precision and recall of the reason code per line, against the planted exceptions.
- **Arrears:** tenancies with rent owing at 30/09/2026 after the automatic pass, compared with the expected amounts; "extra" counts tenancies reported in arrears that should not be.
- **Rent money correctly allocated:** for every tenancy and September week, the smaller of the expected and the allocated amount, summed and divided by the expected total. Misallocated money is money put on a week beyond what it should have received.
- **Model only:** the model sees the same portfolio (tenancies, rents, rent references, jobs and quotes) and the whole statement, and classifies it in batches of 10 lines. Its tenancy choices go through the same ledger arithmetic as the rules, so the comparison is about matching, not arithmetic.
- **Limits of the set:** the statement is synthetic and was written together with the matching policy, so a perfect rules score shows that every planted case is covered, not how the rules would do on an unseen export. Each reason has one or two examples, so per-reason figures move in large steps.
- **Rules + model suggestions:** the rules run unchanged; the model is asked only about the lines they hold as unknown payer or ambiguous. The app shows its answer as a suggestion and never applies it, so the automatic numbers equal the rules. The suggestion accuracy and the ledger a person would get by accepting every suggestion are reported separately.

## Results

| Method | Match accuracy | Exception precision | Exception recall | Arrears found (exact / expected, extra) | Rent money correctly allocated | Weeks right | Model calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rules only | 100% (50/50) | 100% | 100% | 3/3, 0 | 100% (24410/24410; 0 misallocated) | 40/40 | 0 |
| Model only | 98% (49/50) | 70% | 77.8% | 3/3, 0 | 100% (24410/24410; 0 misallocated) | 40/40 | 5 (batches of 10 lines) |
| Rules + model suggestions | 100% (suggestions are not applied) | 100% | 100% | 3/3, 0 | 100% | 40/40 | 3 (one per held line) |

Live model calls in this run: 8 (cache hits: 0, failed: 0). Rules-only time for the whole statement: 73 ms.

### Exception detection by reason

| Reason | Expected | Rules only precision | Rules only recall | Model only precision | Model only recall |
| --- | --- | --- | --- | --- | --- |
| underpaid | 1 | 100% (1/1) | 100% (1/1) | 100% (1/1) | 100% (1/1) |
| overpaid | 1 | 100% (1/1) | 100% (1/1) | 100% (1/1) | 100% (1/1) |
| duplicate | 1 | 100% (1/1) | 100% (1/1) | 100% (1/1) | 100% (1/1) |
| unknown_payer | 2 | 100% (2/2) | 100% (2/2) | 50% (1/2) | 50% (1/2) |
| ambiguous | 1 | 100% (1/1) | 100% (1/1) | n/a (0/0) | 0% (0/1) |
| payment_to_ended_lease | 1 | 100% (1/1) | 100% (1/1) | 50% (1/2) | 100% (1/1) |
| no_matching_job | 1 | 100% (1/1) | 100% (1/1) | 100% (1/1) | 100% (1/1) |
| amount_differs_from_quote | 1 | 100% (1/1) | 100% (1/1) | 50% (1/2) | 100% (1/1) |

### Model suggestions for the lines the rules held

| Line | Payee | Amount | Rules | Real answer | Suggestion | Right |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | B HARRIS | 495 | unknown_payer | none (unidentified) | none: The payer B HARRIS and reference 12 FERN ST do not match any active or ended tenancies in the portfolio. | yes |
| 32 | J LEE | 780 | ambiguous | TAK9 | TAK9: The payment amount of 780 matches the exact weekly rent for TAK9 (Sophie Clarke), and past payments on 7 September and 14 September from J LEE were also allocated to TAK9. | yes |
| 38 | SIONE M | 610 | unknown_payer | GLN22 | GLN22: The bank line features the first name Mele in the particulars and the exact weekly rent amount of $610, which matches Mele Fifita at GLN22. The payment frequency for GLN22 is fortnightly ($1220), meaning this $610 direct credit from SIONE M is likely a weekly part-payment or a specific installment. | yes |

Suggestions right: 3/3. If a person accepted every suggestion naming a tenancy, arrears would match the expected after-review arrears for 2/2 tenancies (extra: none), and 100% of the after-review rent money would be on the right weeks (0 misallocated).

## Arrears at 30/09/2026

| Tenancy | Expected (automatic pass) | Rules only | Model only |
| --- | --- | --- | --- |
| TAK9 | 780 | 780 | 780 |
| ONE3 | 50 | 50 | 50 |
| NLN11 | 1080 | 1080 | 1080 |

TAK9 (Sophie Clarke) is expected in arrears after the automatic pass because her partner's unreferenced payment is held as ambiguous until a person assigns it; after review only ONE3 ($50) and NLN11 ($1,080) remain.

## Items not handled correctly

**Rules only:** none.

**Model only:** 

- Line 14 (G CHEN -760): expected refund HOW30; got refund HOW30, payment_to_ended_lease
- Line 32 (J LEE 780): expected rent, ambiguous; got rent TAK9, unknown_payer
- Line 37 (ACME GARDENS -95): expected contractor, no_matching_job; got contractor (HOW30: End of tenancy clean), no_matching_job
- Line 38 (SIONE M 610): expected unknown, unknown_payer; got rent GLN22
- Line 39 (ACME ELECTRICAL 35): expected contractor (GLN22: Smoke alarms to standard); got contractor (GLN22: Smoke alarms to standard), amount_differs_from_quote

**Model suggestions:** none.


## Reproduce

```bash
cd server
npx tsx scripts/generate-bank.ts                         # the statement and truth.json
AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/reconciliation.ts  # or without the key: rules only
```
