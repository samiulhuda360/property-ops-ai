# Documents: supplier invoices and tenancy summaries

## What it does

Upload a supplier invoice or a tenancy summary as a PDF. Property Ops then does the following:

1. **Reads the fields.**
   - Invoices: supplier, GST number, bank account, invoice number, dates, property, line items, subtotal, GST and total.
   - Tenancy summaries: tenants, property, start and end date (or periodic), weekly rent, bond, how often rent is paid,
     pets and maximum occupants.
2. **Checks them** against the arithmetic and against your records:
   - GST is 3/23 of the total, subtotal plus GST equals the total, and the line items add up to the subtotal.
   - The GST number passes the IRD check digit and matches the contractor on file. The bank account matches the one
     on file.
   - The due date is not before the invoice date.
   - The supplier is a contractor on file and the address is one of your properties.
   - For trade invoices, there is a maintenance job for that property and contractor, and the total is no more than
     10% above the job's quote.
   - The invoice number hasn't already been entered for that supplier.
   - For tenancy summaries, the rent and bond match the lease record and the bond is no more than four weeks' rent.
3. **Links the document** to the property, contractor and job, or to the lease, and puts it in the **Needs review**
   queue.

Each field shows a confidence badge:

- **High:** the value passed every check and the rules read the same value as the model.
- **Medium:** the value passed the checks, but there was nothing else to compare it with.
- **Low:** a check failed on this field, or the model and the rules read different values. Look at these first.

The page says which method reads new uploads. **Model + validation** is used when a model is configured; otherwise
the **Rules** read every document. Both run the same checks.

## How to use it

1. Open **Documents** and click **Upload PDF**. You can choose several files at once. They appear under
   **Needs review** with a summary: "Checks passed" or "1 issue to check".
2. Click **Review**. The PDF is on the left and the fields on the right, under **Checks** and **Matched records**.
3. Compare the fields with the PDF, starting with the problems and the low-confidence fields. Correct any value
   in place. Edited fields are marked **Edited**.
4. Decide:
   - **Approve, nothing is paid or sent** records your check, including any corrections. It needs the supplier,
     invoice number, invoice date, due date and total (for a summary: tenants, property, start date, rent and bond).
   - **Reject** keeps the document under **Rejected**, with your reason if you give one.
5. Export approved invoices to accounting in one of two ways:
   - **Export approved to Xero CSV** downloads every approved invoice in the column layout of Xero's bill-import
     template: `*ContactName`, `EmailAddress`, `*InvoiceNumber`, `*InvoiceDate`, `*DueDate`, `Description`,
     `*Quantity`, `*UnitAmount`, `*AccountCode`, `*TaxType`, `Currency`.
     - There is one row per line item. Dates are DD/MM/YYYY and amounts exclude GST.
     - The tax rate is "15% GST on Expenses". Account codes come from Xero's default NZ chart: 473 for repairs and
       maintenance, 408 cleaning, 433 insurance, 445 utilities, 429 for anything else.
     - In Xero, import the file under **Bills** and choose tax-exclusive amounts.
     - The downloaded invoices move to **Exported**.
   - **Send to accounting as a draft bill** (on an approved invoice) sends that one invoice to the connected
     accounting system as a draft. The demo uses a mock system that keeps drafts in a local file.

The review screen shows the time you have spent on the item. That time is recorded with your decision and feeds
the **Hours returned** report.

## What to check before approving

- **Every problem and check listed.** If the document itself is wrong, for example GST charged at the old 12.5% rate,
  a total well over the quote, or a reminder copy of an invoice already entered, reject it and ask the supplier for
  a corrected invoice.
- **Low-confidence fields**, against the PDF.
- **The matched records.** Make sure it is the right property, contractor and job, or the right lease.
- **Bank account warnings.** Confirm a changed bank account by phone, using the number on file and not the one on
  the invoice.
- **Jobs still marked open or in progress.** Make sure the work is done, then update the job in Maintenance.
- **Credit notes.** A credit note is read like an invoice and has no check of its own. If the document says
  "Credit note", reject it here and enter the credit in the accounting system.
- **Shop-style invoices whose amounts include GST** ("GST content", no subtotal). The line items may be read
  without GST, or flagged as not adding up. Check the line amounts and the total against the PDF.
- **Tenancy summaries that disagree with the lease record.** Approving a summary doesn't change the lease. If the
  summary is right, update the lease under Tenants.

## What it never does

- It never pays an invoice, schedules a payment or sends anything to a supplier or tenant.
- It never posts to accounting on its own. The CSV export and the draft bill are buttons a person presses, and a
  draft bill still waits for approval in the accounting system.
- It never changes leases, jobs or contractor details.
- It never "fixes" a supplier's numbers. Values are read as printed, and problems are shown to you.

## When it's wrong

- **A field is misread:** correct it before approving. Your correction is saved with the document, marked
  "Entered by you", and the review is recorded as corrected.
- **The wrong property or contractor is matched, or none is:** correct the address or supplier name and approve.
  The checks run again on your values. If the supplier is new, add them as a contractor first.
- **A document is flagged but is fine** (for example a job quote that was raised by phone): approve it after checking.
  The note stays with the document.
- **Nothing could be read** (a scan with no text layer): enter the fields by hand, or reject it and ask for a PDF
  with selectable text.
- **An invoice was approved by mistake:** if it hasn't been exported yet, open it and click **Reject**. If it has
  been exported, remove or void the draft bill in the accounting system.
