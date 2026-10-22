# Lease abstraction: evaluation

Two labelled synthetic sets of leases (New Zealand, Australia, the United Kingdom and the United States; commercial and residential), each run through the rules, the model alone and the hybrid route. Run on 2026-10-22 with model `gemini-flash-lite-latest`.

## Seen layouts (24)

12 commercial and 12 residential leases: commercial deeds and leases with a schedule table (New Zealand deed of lease, Australian retail lease, UK lease with particulars, US lease with basic lease information) and residential agreements in four national forms. The rules and the prompt were written with these layouts in view. The labels carry 40 risk clauses, 2 planted check failures and 8 planted invoice mismatches.

| Metric | Rules | Model | Hybrid |
|---|---:|---:|---:|
| Field accuracy, all 25 terms | 100.0% (600/600) | 99.5% (597/600) | 99.5% (597/600) |
| Field accuracy, commercial | 100.0% (300/300) | 99.0% (297/300) | 99.0% (297/300) |
| Field accuracy, residential | 100.0% (300/300) | 100.0% (300/300) | 100.0% (300/300) |
| Field accuracy, NZ | 100.0% (150/150) | 99.3% (149/150) | 99.3% (149/150) |
| Field accuracy, AU | 100.0% (150/150) | 99.3% (149/150) | 99.3% (149/150) |
| Field accuracy, UK | 100.0% (150/150) | 100.0% (150/150) | 100.0% (150/150) |
| Field accuracy, US | 100.0% (150/150) | 99.3% (149/150) | 99.3% (149/150) |
| Leases with every term correct | 24/24 | 21/24 | 21/24 |
| Country and lease type detected | 24/24, 24/24 | 24/24, 24/24 | 24/24, 24/24 |
| Terms with a page located | 95.2% (473/497) | 92.5% (470/508) | 94.5% (480/508) |
| Terms sent to a person (of which wrong) | 3 (0) | 3 (0) | 6 (3) |
| Wrong terms NOT sent to a person | 0 | 3 | 0 |
| Planted check failures caught | 2/2 | 2/2 | 2/2 |
| Clean leases with a false alarm | 1/22 | 1/22 | 4/22 |
| Risk flags: precision | 100.0% (40/40) | 100.0% (40/40) | 100.0% (40/40) |
| Risk flags: recall | 100.0% (40/40) | 100.0% (40/40) | 100.0% (40/40) |
| Planted invoice mismatches found | 8/8 | 8/8 | 8/8 |
| Mismatches reported that were not planted | 0 | 0 | 0 |
| Median latency per lease | 31 ms | 4.27 s | 4.47 s |
| Model calls this run: live / cached | 0 / 0 | 0 / 24 | 0 / 30 |
| Leases that needed the repair call | – | – | 6 |
| Tokens: input / output | – | 45,435 / 30,149 | 58,619 / 37,097 |
| Cost per lease (list price) | $0 | $0.0007 | $0.0009 |

### Seen layouts: accuracy per term

| Term | Rules | Model | Hybrid |
|---|---:|---:|---:|
| Lease reference | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Landlord | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Tenant | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Guarantor | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Premises | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Commencement date | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Expiry date | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Term (months) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Rent per period | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Rent frequency | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Annual rent | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Currency | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Rent review mechanism | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Fixed review (%) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Rent review dates | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Outgoings / service charge / CAM | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Outgoings estimate (annual) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Bond / deposit | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Break notice (months) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Earliest break date | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Renewal rights (number) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Renewal term (months) | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Permitted use | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Make good / reinstatement | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) |
| Insurance obligation | 100.0% (24/24) | 87.5% (21/24) | 87.5% (21/24) |

### Seen layouts: confidence against correctness

| Confidence | Model | Hybrid |
|---|---:|---:|
| high | 99.5% of 567 terms | 100.0% of 491 terms |
| medium | 100.0% of 30 terms | 100.0% of 103 terms |
| low | 100.0% of 3 terms | 50.0% of 6 terms |

## Held-out layouts (8)

4 commercial and 4 residential leases: narrative leases with no schedule table: amounts in words and figures, dates written "1st May 2026" or "11/15/2025", terms such as "operating expenses", "yielding up" and "deposit with the landlord the sum of". Made after the rules were fixed and never used to change them. The labels carry 12 risk clauses, 0 planted check failures and 0 planted invoice mismatches.

| Metric | Rules | Model | Hybrid |
|---|---:|---:|---:|
| Field accuracy, all 25 terms | 24.0% (48/200) | 100.0% (200/200) | 100.0% (200/200) |
| Field accuracy, commercial | 14.0% (14/100) | 100.0% (100/100) | 100.0% (100/100) |
| Field accuracy, residential | 34.0% (34/100) | 100.0% (100/100) | 100.0% (100/100) |
| Field accuracy, NZ | 24.0% (12/50) | 100.0% (50/50) | 100.0% (50/50) |
| Field accuracy, AU | 26.0% (13/50) | 100.0% (50/50) | 100.0% (50/50) |
| Field accuracy, UK | 22.0% (11/50) | 100.0% (50/50) | 100.0% (50/50) |
| Field accuracy, US | 24.0% (12/50) | 100.0% (50/50) | 100.0% (50/50) |
| Leases with every term correct | 0/8 | 8/8 | 8/8 |
| Country and lease type detected | 8/8, 8/8 | 8/8, 8/8 | 8/8, 8/8 |
| Terms with a page located | 45.5% (10/22) | 91.7% (155/169) | 91.1% (154/169) |
| Terms sent to a person (of which wrong) | 51 (51) | 0 (0) | 9 (0) |
| Wrong terms NOT sent to a person | 101 | 0 | 0 |
| Planted check failures caught | 0/0 | 0/0 | 0/0 |
| Clean leases with a false alarm | 8/8 | 0/8 | 7/8 |
| Risk flags: precision | 100.0% (1/1) | 100.0% (12/12) | 100.0% (12/12) |
| Risk flags: recall | 8.3% (1/12) | 100.0% (12/12) | 100.0% (12/12) |
| Median latency per lease | 24 ms | 4.52 s | 8.60 s |
| Model calls this run: live / cached | 0 / 0 | 0 / 8 | 0 / 15 |
| Leases that needed the repair call | – | – | 7 |
| Tokens: input / output | – | 14,304 / 11,327 | 29,021 / 20,731 |
| Cost per lease (list price) | $0 | $0.0007 | $0.0014 |

### Held-out layouts: accuracy per term

| Term | Rules | Model | Hybrid |
|---|---:|---:|---:|
| Lease reference | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Landlord | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Tenant | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Guarantor | 62.5% (5/8) | 100.0% (8/8) | 100.0% (8/8) |
| Premises | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Commencement date | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Expiry date | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Term (months) | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Rent per period | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Rent frequency | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Annual rent | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Currency | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) |
| Rent review mechanism | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Fixed review (%) | 75.0% (6/8) | 100.0% (8/8) | 100.0% (8/8) |
| Rent review dates | 50.0% (4/8) | 100.0% (8/8) | 100.0% (8/8) |
| Outgoings / service charge / CAM | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Outgoings estimate (annual) | 62.5% (5/8) | 100.0% (8/8) | 100.0% (8/8) |
| Bond / deposit | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Break notice (months) | 62.5% (5/8) | 100.0% (8/8) | 100.0% (8/8) |
| Earliest break date | 62.5% (5/8) | 100.0% (8/8) | 100.0% (8/8) |
| Renewal rights (number) | 50.0% (4/8) | 100.0% (8/8) | 100.0% (8/8) |
| Renewal term (months) | 75.0% (6/8) | 100.0% (8/8) | 100.0% (8/8) |
| Permitted use | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Make good / reinstatement | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |
| Insurance obligation | 0.0% (0/8) | 100.0% (8/8) | 100.0% (8/8) |

### Held-out layouts: confidence against correctness

| Confidence | Model | Hybrid |
|---|---:|---:|
| high | 100.0% of 192 terms | 100.0% of 13 terms |
| medium | 100.0% of 8 terms | 100.0% of 178 terms |
| low | no terms | 100.0% of 9 terms |

## How it is measured

- Every lease is labelled with its 25 key terms, the risk clauses it contains (from the playbook's nine codes), any check it should fail, and the charges the billing system should have raised. The invoice file holds the raised invoices with planted mismatches.
- A term is correct when it equals the label after normalising: dates to ISO, money to cents, names and addresses to lower case without punctuation (one may contain the other), review dates as a sorted set. A missing value is wrong unless the lease has none.
- "Sent to a person" counts terms with low confidence: a failed or disagreeing check, or (hybrid) a disagreement between the model and the rules. The number in brackets is how many of those were in fact wrong; the next row is the wrong terms that slipped through with medium or high confidence.
- Risk precision and recall compare the playbook findings with the labelled risk codes per lease. The playbook runs after every route, so its findings depend on the terms that route extracted.
- Reconciliation: the charge schedule derived from the extracted terms is matched to the invoice file by lease reference, kind and due date (within three days); a planted mismatch is found when the same status, kind and due date is reported.
- Latency per lease: reading the PDF text, plus each model call's recorded latency (the same figure whether the reply came live or from the disk cache), plus the rules, checks, playbook and schedule. Live calls were spaced at least 4.5 s apart; that spacing is not counted.
- Cost uses the tokens the API reported for the calls, at the list price assumed for the model: $0.1 per million input tokens and $0.4 per million output tokens. Cached replays report the tokens of the original call.
- The hybrid route reuses the model-only call (the identical request is served from the cache) and adds one repair call when a check fails.
- The rules and the prompt were written with the seen layouts in view. The held-out layouts were made afterwards and have not been used to change either, so they show how each route copes with a lease written in a form it has not met.

## Terms not read correctly

### Seen layouts: Rules

Every term and every risk clause was handled correctly.

### Seen layouts: Model

- `lease-c-nz-02.pdf`: insurance: expected "tenant", read "both"
- `lease-c-au-03.pdf`: insurance: expected "tenant", read "both"
- `lease-c-us-02.pdf`: insurance: expected "tenant", read "both"

### Seen layouts: Hybrid

- `lease-c-nz-02.pdf`: insurance: expected "tenant", read "both" (sent to a person)
- `lease-c-au-03.pdf`: insurance: expected "tenant", read "both" (sent to a person)
- `lease-c-us-02.pdf`: insurance: expected "tenant", read "both" (sent to a person)

### Held-out layouts: Rules

- `lease-h-nz-01.pdf`: 22 terms wrong (leaseRef, landlord, tenant, guarantor, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, reviewPercent, reviewDates, outgoingsBasis, outgoingsAnnual, bondAmount, renewalTerms, renewalTermMonths, permittedUse, makeGood, insurance); missed risk personal_guarantee, uncapped_outgoings, make_good_tenant_cost
- `lease-h-nz-02.pdf`: 16 terms wrong (leaseRef, landlord, tenant, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, outgoingsBasis, bondAmount, permittedUse, makeGood, insurance)
- `lease-h-au-01.pdf`: 21 terms wrong (leaseRef, landlord, tenant, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, reviewDates, outgoingsBasis, outgoingsAnnual, bondAmount, breakNoticeMonths, breakDate, renewalTerms, permittedUse, makeGood, insurance); missed risk uncapped_outgoings
- `lease-h-au-02.pdf`: 16 terms wrong (leaseRef, landlord, tenant, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, outgoingsBasis, bondAmount, permittedUse, makeGood, insurance)
- `lease-h-uk-01.pdf`: 21 terms wrong (leaseRef, landlord, tenant, guarantor, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, reviewDates, outgoingsBasis, bondAmount, breakNoticeMonths, breakDate, renewalTerms, permittedUse, makeGood, insurance); missed risk personal_guarantee, uncapped_outgoings, make_good_tenant_cost
- `lease-h-uk-02.pdf`: 18 terms wrong (leaseRef, landlord, tenant, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, outgoingsBasis, bondAmount, breakNoticeMonths, breakDate, permittedUse, makeGood, insurance); missed risk short_break_notice
- `lease-h-us-01.pdf`: 22 terms wrong (leaseRef, landlord, tenant, guarantor, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, reviewPercent, reviewDates, outgoingsBasis, outgoingsAnnual, bondAmount, renewalTerms, renewalTermMonths, permittedUse, makeGood, insurance); missed risk personal_guarantee, uncapped_outgoings, make_good_tenant_cost
- `lease-h-us-02.pdf`: 16 terms wrong (leaseRef, landlord, tenant, premises, commencementDate, expiryDate, termMonths, rentAmount, rentFrequency, annualRent, reviewMechanism, outgoingsBasis, bondAmount, permittedUse, makeGood, insurance)

### Held-out layouts: Model

Every term and every risk clause was handled correctly.

### Held-out layouts: Hybrid

Every term and every risk clause was handled correctly.

