# Leases: staff guide

The Leases page reads a signed lease and lays out its key terms beside the document, so you check instead of
re-type. It works for commercial and residential leases from New Zealand, Australia, the United Kingdom and the
United States.

## Adding a lease

- **Upload a lease PDF** (the signed deed or agreement, up to 10 MB), or
- **Pick a sample lease** from the list and click **Abstract sample** to see how the page works.

The lease opens in review within a few seconds. The note at the top says how many terms need a person, how many
risk clauses were found, and how many charges need checking.

## Reviewing the terms

The lease is on the left; the terms are on the right in four groups: parties and premises, term, money, obligations.

For each term you see:
- the **value** the app read, and the **sentence** it came from;
- a **page** button: click it and the sentence is highlighted on the page;
- a **confidence**: high (the checks pass and two readers agree), medium (nothing to compare it with, or the lease
  does not state it), low (a check failed or the readers disagree);
- a **status**: Read, Needs a person, Approved or Corrected.

Click **Approve** when the value is right, or **Correct** to type the right value and **Save**. A correction re-runs
the checks, the risk flags, the charge schedule and the invoice check. Every approval and correction is written to
the audit trail with your name.

Problems the checks found are listed above the table in plain words: an expiry before the commencement, a term that
does not match the dates, a review date outside the term, a rent per period that does not agree with the annual
rent, a currency that does not match the country, a bond above the usual limit.

## Risk flags

The **Risks** tab lists the clauses the playbook watches for: a personal guarantee, an upward-only (ratchet) rent
review, uncapped outgoings or service charge, make good at the tenant's cost, a short notice period for ending the
lease early, a landlord's right to end the lease early, a fixed review of 4% or more, a short term with no renewal,
and a relocation clause. Each one quotes the clause and cites its page. **Accept** a finding to note it for the
owner, or **Dismiss** it when it does not apply.

## Charges and invoices

The **Charges** tab shows what should be invoiced in the first twelve months: the bond or deposit on commencement,
the rent for each period, and the outgoings (service charge, CAM) estimate in monthly instalments. Each line is
matched to the invoice the billing system raised for the same lease reference:
- **Matched:** the invoice exists for the same amount;
- **Amount differs:** the invoice was raised for a different amount;
- **Not invoiced:** no invoice was raised;
- **Not in the lease:** an invoice was raised that the lease does not provide for.

Each invoice is cited by its number and the row of the import file. To load the billing system's invoices, export
them as a CSV with the columns `row, invoice_number, lease_ref, description, kind, amount, currency, due_date,
period` (kind is `rent`, `outgoings`, `bond` or `other`) and send it to `POST /api/lease-abstracts/invoices`.

## Approving the lease

**Approve lease** is available once every term marked "needs a person" has been approved or corrected. Approval
records the decision; nothing is posted to the billing system. **Reject** with a reason when the file is wrong.

**Export JSON** or **Export CSV** gives you the terms with their pages and quotes, the risk findings, the charge
schedule and the reconciliation, for the billing system or the owner's file.

## Audit trail

The **Audit trail** tab lists every event on the lease: the extraction (which route read it and what it flagged),
each approved or corrected term with the value before and after, each risk decision, and the final approval or
rejection, with who did it and when.
