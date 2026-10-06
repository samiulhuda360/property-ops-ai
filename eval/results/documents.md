# Document extraction: evaluation

Labelled synthetic set: 30 supplier invoices in six layouts and 10 tenancy summaries in two layouts (40 PDFs). 12 documents carry 13 planted problems; the other 28 are clean. Run on 2026-10-06 with model `gemini-flash-lite-latest`.

## Results

| Metric | Rules | Model | Model + validation |
|---|---:|---:|---:|
| Field accuracy, all fields | 100.0% (420/420) | 100.0% (420/420) | 100.0% (420/420) |
| Field accuracy, invoices | 100.0% (330/330) | 100.0% (330/330) | 100.0% (330/330) |
| Field accuracy, tenancy summaries | 100.0% (90/90) | 100.0% (90/90) | 100.0% (90/90) |
| Documents fully correct | 40/40 | 40/40 | 40/40 |
| Planted problems caught (recall) | 100.0% (13/13) | 100.0% (13/13) | 100.0% (13/13) |
| Clean documents with a false alarm | 0/28 | 0/28 | 0/28 |
| Extra issues on planted documents | 0 | 0 | 0 |
| Median latency per document | 15 ms | 2.18 s | 2.41 s |
| Model calls this run: live / cached | 0 / 0 | 39 / 1 | 12 / 40 |
| Documents that needed the repair call | – | – | 12 |

The methods read the same share of fields correctly on this set, so it does not separate them on accuracy. Every PDF has a clean text layer, and the rules were written for these layouts. The planted problems are caught by the business checks, which run after every method.

## Field accuracy per field

| Field | Rules | Model | Model + validation |
|---|---:|---:|---:|
| Invoice: supplierName | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: supplierGstNumber | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: supplierBankAccount | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: invoiceNumber | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: invoiceDate | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: dueDate | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: propertyAddress | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: lineItems | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: subtotal | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: gst | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Invoice: total | 100.0% (30/30) | 100.0% (30/30) | 100.0% (30/30) |
| Summary: tenantNames | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: propertyAddress | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: startDate | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: endDate | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: weeklyRent | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: bond | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: rentFrequency | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: petsAllowed | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |
| Summary: maxOccupants | 100.0% (10/10) | 100.0% (10/10) | 100.0% (10/10) |

## Confidence against correctness

How often a field was right at each confidence level. For the model alone the confidence is its own; for model + validation it comes from the checks and the agreement with the rules.

| Confidence | Model | Model + validation |
|---|---:|---:|
| high | 100.0% of 420 fields | 100.0% of 403 fields |
| medium | no fields | no fields |
| low | no fields | 100.0% of 17 fields |

## How it is measured

- Every document goes through each method in the same order, starting from an empty document store, so the re-sent invoice is a duplicate of the one before it. Reference data (properties, contractors, maintenance jobs and quotes, leases) comes from the seeded demo database.
- A field is correct when it equals the labelled value after normalising: dates to ISO, money to cents, addresses to lower case without punctuation (abbreviations such as Rd and Mt expanded, city and postcode dropped), GST and bank numbers to digits, supplier names without legal suffixes, line items compared by their amounts. A missing value is wrong unless the document has none (the GST number on one invoice).
- A planted problem is caught when its issue (error or warning) is raised on that document. A false alarm is any error or warning on a clean document; notes marked info (for example "the job is still in progress") are context, not alarms.
- Latency per document: reading the PDF text, plus each model call's recorded latency (the same figure whether the reply came live or from the disk cache), plus the rules and checks. Live calls were spaced at least 2.5 s apart; that waiting is not counted.
- Model + validation reuses the model-only call (the identical request is served from the cache) and adds one repair call when the checks fail.
- The rules were written for these six invoice layouts and two summary layouts, so their score here is the best case: a supplier with a new layout needs new rules, while the model reads it unchanged.

## Items not handled correctly

### Rules

Every field and every planted problem was handled correctly, with no false alarms.

### Model

Every field and every planted problem was handled correctly, with no false alarms.

### Model + validation

Every field and every planted problem was handled correctly, with no false alarms.

