# Staff guide: rent reconciliation

**Who it's for:** accounts, once a week or once a month, when the trust account statement comes in.

**What it does:** reads the bank's CSV export, matches every line to rent, a contractor job, a bond, a refund, a
bank fee or a transfer, updates the rent ledger, and holds anything unclear for you to decide. You get the
arrears list and an Excel exceptions report at the end.

![The Reconciliation page after importing a statement](../screenshots/reconciliation.png)

## How it matches a line

Money in is matched to a tenancy in order of confidence:

1. **Reference:** the reference, particulars or code name the tenancy's rent reference (for example `NGATA MTE14`,
   in any case and with extra words) or its property code.
2. **Payer name:** the payer is the tenant (surname with the first name or initial, such as `R PATEL`).
3. **Amount and date:** the amount is one or two weeks' rent of exactly one tenancy that has rent due around the
   payment date. This is shown with a lower confidence.

The money then pays that tenancy's unpaid rent **oldest week first**, for weeks due up to 6 days after the
payment. If what is left is a whole number of weeks' rent, it pays the following weeks in advance (a fortnightly
payer). Anything else is held as **credit**. A week is marked paid, with the date the money arrived, only when it is
fully covered; a part-paid week stays pending with the balance owing.

Money out is matched to a **contractor job** by the contractor's name, the property code in the reference and the
quoted amount. Bank fees and transfers are recognised by their transaction type and wording.

## Step by step

1. Download the statement from the bank as CSV (Date, Amount, Payee, Particulars, Code, Reference, Transaction
   Type). Separate Debit and Credit columns also work.
2. Open **Reconciliation** and click **Import CSV**. The message says how many lines were matched and how many
   need you. Importing the same file again changes nothing: lines already imported are skipped.
3. Read the four cards: bank lines, the share matched, exceptions open, and arrears at the statement end.
4. Work through **Exceptions to review**. Click **Review** on a line: the bank line as exported is on the left,
   what the rules found and the suggested action are on the right.
5. Decide with the buttons. Each says what it does:
   - **Accept**: keep what the engine proposed (for example, keep the part-payment, keep the extra as credit).
   - **Assign to a tenancy** or **Link to this job**: put the money where it belongs; the rent ledger is rebuilt.
   - **Leave out**: the line stays on record but doesn't count towards rent.
   Add a note if you checked something outside the app, such as a phone call.
6. Check **Arrears** and **Credit held**, then click **Download Excel** for the record or the owner report.

The time from opening a line to your decision is recorded and goes into the hours-returned report.

## What each exception means

| Reason | What happened | Usual decision |
|---|---|---|
| Underpaid | Less than the weekly rent, and rent is still owing | Accept, then contact the tenant about the shortfall |
| Overpaid | More than the rent due; the extra is held as credit | Accept (credit stays), or refund outside the app |
| Possible duplicate | Same date, amount, payer and reference as an earlier line | Leave out if exported twice; assign it if the tenant really paid twice |
| Unknown payer | No tenancy matches the reference, payer or amount | Find out who paid, then assign it, or leave it out and return the money |
| Ambiguous | The evidence points to more than one tenancy or job | Confirm who paid, then assign it |
| Payment to an ended tenancy | Money for a tenancy that has ended (often an automatic payment left running) | Accept (refund due), and refund the former tenant from the bank |
| No matching job | A contractor was paid but none of its jobs matches the property or amount | Find the invoice and job; link it, or add the job under Maintenance |
| Amount differs from quote | The job was found but the payment isn't the quoted amount | Check the invoice for agreed extra work, then accept or query the contractor |

![Reviewing an ambiguous line, with the model's suggestion](../screenshots/reconciliation-review.png)

## Model suggestions

When a model is configured, it is asked about the lines the rules hold as **unknown payer** or **ambiguous**. Its
answer appears in a dashed blue box marked **Model suggestion (not applied)**, with its reason. It sees the line,
the tenancies with their rents and references, and who has paid each tenancy this month. Using it is your
decision: click **Use the suggestion** only once the reason checks out against the statement. With no model
configured, everything else works the same and the page says **Model off: rules only**.

## Check before you decide

- **The source:** compare the payer, particulars, code and reference on the left with the explanation on the right.
- **Lower-confidence matches:** lines matched by amount and date (shown in **Matched lines** with their method and
  confidence) deserve a glance. Use **Check** to correct one.
- **Credit and arrears:** after assigning a held line, the arrears and credit panels update. Make sure the result
  is what you expect before chasing anyone.
- **Duplicates:** check the bank account itself before leaving a line out.

## What it never does

- It never pays, refunds or sends anything. Refunds and arrears letters are done by you, outside the app.
- It never applies a model suggestion by itself.
- It never counts the same bank line twice, even if the file is imported again or under another name.
- It doesn't change maintenance jobs or bonds; it only links payments to them.

## When it's wrong

- **Wrong tenancy on a matched line:** open **Matched lines**, click **Check**, and assign the right tenancy. The
  ledger for both tenancies is rebuilt and the correction is recorded.
- **Something you decided needs undoing:** open the line from **Show resolved** and decide again.
- **A file won't import:** the message names the row that couldn't be read (usually a date that isn't
  dd/mm/yyyy or an amount with text in it). Fix the export or download it again.
- **A rent was paid by hand outside the bank account:** record it on the Payments page. Weeks that a bank line
  has paid are kept in step with the bank lines, so mark those through this page instead.
