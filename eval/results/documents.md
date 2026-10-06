# Document extraction: evaluation

Two labelled synthetic sets of supplier invoices and tenancy summaries, each run through the rules, the model alone, and the model with validation. Run on 2026-10-06 with model `gemini-flash-lite-latest`.

## Seen layouts (40)

30 supplier invoices and 10 tenancy summaries: six invoice layouts (classic table, letter, receipt, water bill, insurance renewal, two-column) and two tenancy summary layouts. The rules and prompts were written with these layouts in view. 12 documents carry 13 planted problems; the other 28 are clean.

| Metric | Rules | Model | Model + validation |
|---|---:|---:|---:|
| Field accuracy, all fields | 100.0% (420/420) | 100.0% (420/420) | 100.0% (420/420) |
| Field accuracy, invoices | 100.0% (330/330) | 100.0% (330/330) | 100.0% (330/330) |
| Field accuracy, tenancy summaries | 100.0% (90/90) | 100.0% (90/90) | 100.0% (90/90) |
| Documents fully correct | 40/40 | 40/40 | 40/40 |
| Planted problems caught (recall) | 100.0% (13/13) | 100.0% (13/13) | 100.0% (13/13) |
| Clean documents with a false alarm | 0/28 | 0/28 | 0/28 |
| Extra issues on planted documents | 0 | 0 | 0 |
| Median latency per document | 17 ms | 2.19 s | 2.41 s |
| Model calls this run: live / cached | 0 / 0 | 0 / 40 | 0 / 52 |
| Documents that needed the repair call | – | – | 12 |

The methods read the same share of fields correctly on this set, so it does not separate them on accuracy. The planted problems are caught by the business checks, which run after every method.

### Seen layouts: accuracy per field

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

### Seen layouts: confidence against correctness

| Confidence | Model | Model + validation |
|---|---:|---:|
| high | 100.0% of 420 fields | 100.0% of 403 fields |
| medium | no fields | no fields |
| low | no fields | 100.0% of 17 fields |

## Held-out layouts (15)

12 supplier invoices and 3 tenancy summaries: four layouts made after the rules and prompts were fixed, and never used to change them: totals above the line items with dates written out ("the 3rd of September 2026"), a GST-inclusive shop invoice with "Amount payable" and "GST content" and no subtotal, a detailed layout with two-digit-year dates that includes a two-page invoice and a credit note, and a tenancy summary written as a letter. 5 documents carry 5 planted problems; the other 10 are clean.

| Metric | Rules | Model | Model + validation |
|---|---:|---:|---:|
| Field accuracy, all fields | 46.5% (74/159) | 93.7% (149/159) | 93.7% (149/159) |
| Field accuracy, invoices | 52.3% (69/132) | 92.4% (122/132) | 92.4% (122/132) |
| Field accuracy, tenancy summaries | 18.5% (5/27) | 100.0% (27/27) | 100.0% (27/27) |
| Documents fully correct | 0/15 | 10/15 | 10/15 |
| Planted problems caught (recall) | 40.0% (2/5) | 80.0% (4/5) | 80.0% (4/5) |
| Clean documents with a false alarm | 10/10 | 1/10 | 1/10 |
| Extra issues on planted documents | 8 | 3 | 3 |
| Median latency per document | 19 ms | 11.22 s | 14.91 s |
| Model calls this run: live / cached | 0 / 0 | 15 / 0 | 6 / 15 |
| Documents that needed the repair call | – | – | 6 |

### Held-out layouts: accuracy per field

| Field | Rules | Model | Model + validation |
|---|---:|---:|---:|
| Invoice: supplierName | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: supplierGstNumber | 66.7% (8/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: supplierBankAccount | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: invoiceNumber | 66.7% (8/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: invoiceDate | 0.0% (0/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: dueDate | 8.3% (1/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: propertyAddress | 66.7% (8/12) | 100.0% (12/12) | 100.0% (12/12) |
| Invoice: lineItems | 0.0% (0/12) | 75.0% (9/12) | 75.0% (9/12) |
| Invoice: subtotal | 33.3% (4/12) | 58.3% (7/12) | 58.3% (7/12) |
| Invoice: gst | 66.7% (8/12) | 91.7% (11/12) | 91.7% (11/12) |
| Invoice: total | 66.7% (8/12) | 91.7% (11/12) | 91.7% (11/12) |
| Summary: tenantNames | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: propertyAddress | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: startDate | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: endDate | 66.7% (2/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: weeklyRent | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: bond | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: rentFrequency | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: petsAllowed | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |
| Summary: maxOccupants | 0.0% (0/3) | 100.0% (3/3) | 100.0% (3/3) |

### Held-out layouts: confidence against correctness

| Confidence | Model | Model + validation |
|---|---:|---:|
| high | 99.3% of 150 fields | 100.0% of 63 fields |
| medium | 0.0% of 4 fields | 94.7% of 75 fields |
| low | 0.0% of 5 fields | 71.4% of 21 fields |

## How it is measured

- Each set goes through each method in the same order, starting from an empty document store, so a re-sent invoice is a duplicate of the one before it. Reference data (properties, contractors, maintenance jobs and quotes, leases) comes from the seeded demo database.
- A field is correct when it equals the labelled value after normalising: dates to ISO, money to cents, addresses to lower case without punctuation (abbreviations such as Rd and Mt expanded, city and postcode dropped), GST and bank numbers to digits, supplier names without legal suffixes, line items compared by their amounts. A missing value is wrong unless the document has none. Labelled values are what the document prints: on the GST-inclusive shop invoices the line amounts include GST and there is no subtotal; on the credit note the amounts are negative.
- A planted problem is caught when its issue (error or warning) is raised on that document. A false alarm is any error or warning on a clean document; notes marked info (for example "the job is still in progress") are context, not alarms. The credit note is labelled `credit_note`, an issue the checks have no rule for.
- Latency per document: reading the PDF text, plus each model call's recorded latency (the same figure whether the reply came live or from the disk cache), plus the rules and checks. The latency of a call runs from its first attempt, so it includes any retry waits after rate-limit responses from the shared API key; the seen-set and held-out calls were made at different times. Live calls were spaced at least 2.5 s apart; that spacing is not counted.
- Model + validation reuses the model-only call (the identical request is served from the cache) and adds one repair call when the checks fail.
- The rules and the prompts were written with the seen layouts in view. The held-out layouts were made afterwards and have not been used to change either, so they show how each method copes with a supplier format it has not met.

## Items not handled correctly

### Seen layouts: Rules

Every field and every planted problem was handled correctly, with no false alarms.

### Seen layouts: Model

Every field and every planted problem was handled correctly, with no false alarms.

### Seen layouts: Model + validation

Every field and every planted problem was handled correctly, with no false alarms.

### Held-out layouts: Rules

- `h-invoice-01-plumbing-mte14.pdf`: supplierGstNumber: expected "102-345-673", read nothing; invoiceDate: expected "2026-09-03", read nothing; dueDate: expected "2026-09-17", read nothing; propertyAddress: expected "14 Kowhai Road, Mount Eden, Auckland 1024", read "14 Kowhai Road, Mount Eden, Auckland 1024 (Hot water cylinder element)"; lineItems: expected 3 lines (42.00, 200.00, 245.00), read nothing; subtotal: expected $487.00, read nothing; gst: expected $73.05, read nothing; missed over_quote; raised missing_field, gst_number_missing, property_unknown (not planted)
- `h-invoice-02-roofing-hnd5.pdf`: supplierGstNumber: expected "118-765-435", read nothing; invoiceDate: expected "2026-09-24", read nothing; dueDate: expected "2026-10-08", read nothing; propertyAddress: expected "5 Rimu Cres, Henderson", read "5 Rimu Cres, Henderson (Gutter clean and downpipe)"; lineItems: expected 3 lines (60.00, 120.00, 260.00), read nothing; subtotal: expected $440.00, read nothing; gst: expected $66.00, read nothing; raised missing_field, gst_number_missing (not planted)
- `h-invoice-03-pest-avd25.pdf`: supplierGstNumber: expected "127-654-328", read nothing; invoiceDate: expected "2026-09-29", read nothing; dueDate: expected "2026-10-13", read nothing; propertyAddress: expected "25 Puriri Street, Avondale", read "25 Puriri Street, Avondale (Rodent treatment)"; lineItems: expected 2 lines (60.00, 140.00), read nothing; subtotal: expected $200.00, read nothing; gst: expected $30.00, read nothing; raised missing_field, gst_number_missing (not planted)
- `h-invoice-04-plumbing-pon7.pdf`: supplierGstNumber: expected "102-345-673", read nothing; invoiceDate: expected "2026-09-15", read nothing; dueDate: expected "2026-09-29", read nothing; propertyAddress: expected "7 Vine Street, Ponsonby", read "7 Vine Street, Ponsonby (Leaking kitchen mixer)"; lineItems: expected 2 lines (35.00, 135.00), read nothing; subtotal: expected $170.00, read nothing; gst: expected $25.50, read nothing; raised missing_field, gst_number_missing (not planted)
- `h-invoice-05-gardens-pap18.pdf`: invoiceDate: expected "2026-09-03", read nothing; dueDate: expected "2026-09-17", read nothing; lineItems: expected 3 lines (23.00, 69.00, 80.50), read nothing; raised missing_field (not planted)
- `h-invoice-06-locksmiths-tak9.pdf`: invoiceDate: expected "2026-09-18", read nothing; dueDate: expected "2026-10-02", read nothing; lineItems: expected 2 lines (86.25, 166.75), read nothing; raised missing_field (not planted)
- `h-invoice-07-cleaning-nln11.pdf`: invoiceDate: expected "2026-09-28", read nothing; dueDate: expected "2026-10-12", read nothing; lineItems: expected 2 lines (172.50, 230.00), read nothing; raised missing_field (not planted)
- `h-invoice-08-cleaning-how30.pdf`: invoiceDate: expected "2026-09-10", read nothing; dueDate: expected "2026-09-24", read nothing; lineItems: expected 2 lines (138.00, 207.00), read nothing; raised missing_field (not planted)
- `h-invoice-09-electrical-gln22.pdf`: invoiceNumber: expected "E-11002", read nothing; invoiceDate: expected "2026-09-04", read nothing; dueDate: expected "2026-09-18", read nothing; lineItems: expected 3 lines (60.00, 108.00, 144.00), read nothing; subtotal: expected $312.00, read nothing; total: expected $358.80, read $18.09; raised missing_field, gst_not_3_23 (not planted)
- `h-credit-10-electrical-mrb6.pdf`: invoiceNumber: expected "CN-0042", read nothing; invoiceDate: expected "2026-09-25", read nothing; lineItems: expected 1 lines (-36.00), read nothing; subtotal: expected $-36.00, read nothing; total: expected $-41.40, read nothing; missed credit_note; raised missing_field (not planted)
- `h-invoice-11-electrical-one3.pdf`: invoiceNumber: expected "E-11019", read nothing; invoiceDate: expected "2026-09-30", read nothing; dueDate: expected "2026-10-14", read nothing; lineItems: expected 3 lines (64.00, 72.00, 114.00), read nothing; subtotal: expected $250.00, read nothing; total: expected $287.50, read $14.10; raised missing_field, gst_not_3_23 (not planted)
- `h-invoice-12-electrical-papakura.pdf`: invoiceNumber: expected "E-11025", read nothing; invoiceDate: expected "2026-09-22", read nothing; dueDate: expected "2026-10-06", read nothing; lineItems: expected 2 lines (72.00, 95.00), read nothing; subtotal: expected $167.00, read nothing; total: expected $192.05, read $6.10; raised missing_field, gst_not_3_23 (not planted)
- `h-lease-13-avd25.pdf`: tenantNames: expected ["Wiremu Parata"], read nothing; propertyAddress: expected "25 Puriri Street, Avondale, Auckland 1026", read nothing; startDate: expected "2025-08-25", read nothing; weeklyRent: expected $600.00, read nothing; bond: expected $2400.00, read nothing; petsAllowed: expected false, read nothing; maxOccupants: expected 5, read nothing; raised missing_field (not planted)
- `h-lease-14-hnd5.pdf`: tenantNames: expected ["Rajesh Patel","Priya Patel"], read nothing; propertyAddress: expected "5 Rimu Crescent, Henderson, Auckland 0612", read nothing; startDate: expected "2023-09-18", read nothing; weeklyRent: expected $700.00, read nothing; bond: expected $2720.00, read nothing; petsAllowed: expected true, read nothing; maxOccupants: expected 6, read nothing; missed rent_differs; raised missing_field (not planted)
- `h-lease-15-tak9.pdf`: tenantNames: expected ["Sophie Clarke"], read nothing; propertyAddress: expected "9 Totara Avenue, Takapuna, Auckland 0622", read nothing; startDate: expected "2025-01-13", read nothing; endDate: expected "2027-01-12", read nothing; weeklyRent: expected $780.00, read nothing; bond: expected $3120.00, read nothing; petsAllowed: expected false, read nothing; maxOccupants: expected 5, read nothing; raised missing_field (not planted)

### Held-out layouts: Model

- `h-invoice-05-gardens-pap18.pdf`: lineItems: expected 3 lines (23.00, 69.00, 80.50), read 3 lines (20.00, 60.00, 70.00); subtotal: expected nothing, read $150.00
- `h-invoice-06-locksmiths-tak9.pdf`: subtotal: expected nothing, read $220.00; raised line_items_dont_add (not planted)
- `h-invoice-07-cleaning-nln11.pdf`: subtotal: expected nothing, read $342.12; raised line_items_dont_add (not planted)
- `h-invoice-08-cleaning-how30.pdf`: lineItems: expected 2 lines (138.00, 207.00), read 2 lines (120.00, 180.00); subtotal: expected nothing, read $300.00
- `h-credit-10-electrical-mrb6.pdf`: lineItems: expected 1 lines (-36.00), read nothing; subtotal: expected $-36.00, read nothing; gst: expected $-5.40, read nothing; total: expected $-41.40, read nothing; missed credit_note; raised invalid_value, missing_field (not planted)

### Held-out layouts: Model + validation

- `h-invoice-05-gardens-pap18.pdf`: lineItems: expected 3 lines (23.00, 69.00, 80.50), read 3 lines (20.00, 60.00, 70.00); subtotal: expected nothing, read $150.00
- `h-invoice-06-locksmiths-tak9.pdf`: subtotal: expected nothing, read $220.00; raised line_items_dont_add (not planted)
- `h-invoice-07-cleaning-nln11.pdf`: subtotal: expected nothing, read $342.12; raised line_items_dont_add (not planted)
- `h-invoice-08-cleaning-how30.pdf`: lineItems: expected 2 lines (138.00, 207.00), read 2 lines (120.00, 180.00); subtotal: expected nothing, read $300.00
- `h-credit-10-electrical-mrb6.pdf`: lineItems: expected 1 lines (-36.00), read nothing; subtotal: expected $-36.00, read nothing; gst: expected $-5.40, read nothing; total: expected $-41.40, read nothing; missed credit_note; raised invalid_value, missing_field (not planted)

