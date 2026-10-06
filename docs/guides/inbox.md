# Tenant inbox: staff guide

The tenant inbox reads every email sent to the property management mailbox, sorts it, and drafts a reply for you
to check. You stay in charge: nothing is ever emailed from Property Ops, and every reply waits for your approval.

![The tenant inbox with urgent emails first](../screenshots/inbox.png)

## What it does

For each email it:

1. **Works out who sent it.** It matches the sender's address to a tenant, then the tenant's current lease and
   property. If the address isn't on file, it looks for the tenant's name (or phone number) together with their
   address in the signature. A neighbour or a supplier who mentions an address is linked to the property only.
2. **Sorts it.** Category (maintenance, rent, lease question, complaint, end of tenancy, other) and urgency (urgent,
   high, normal, low).
3. **Spots urgent safety issues.** A smell of gas, flooding or a burst pipe, sparking or burning electrics, water
   near a light fitting, sewage, no hot water, a home that can't be locked after a break-in, or no heating with a
   baby or vulnerable person in the home. These are always marked urgent, even when the email is polite and says
   "no rush".
4. **Logs repairs.** A repair email creates a maintenance job (source "inbox") with a matching priority. If the same
   issue at the same property was reported in the last 7 days, or already has an open job, the email is linked to
   that job instead of creating a second one.
5. **Drafts a reply** that cites the tenancy terms that apply, for example "(Tenancy terms §7)". The clause text is
   shown in full beside the draft so you can check it.
6. **Says when it needs you,** and why (the amber "Why this needs a person" box).

With a model configured the triage uses AI plus these rules ("AI + rules" on the message). Without one, the rules do
everything ("Rules only"): keyword sorting, a template reply citing the matching clause, and every message marked
for a person.

## Using it day to day

1. Open **Tenant inbox**. The **To review** list shows urgent emails first, with a red edge.
2. Click a message. The email is on the left of the triage, so you can compare them.
3. Read the amber box, if there is one. It lists everything that needs your decision.
4. Check the tenant, the property and the maintenance job. The job number links to **Maintenance**.
5. Edit the reply if needed, then click **Approve reply (not sent)**. The reply is saved as approved. Click
   **Copy reply** and send it from your own email.
6. If no reply is needed (spam, a duplicate, already handled by phone), click **Dismiss, no reply**.
7. If you've just added the tenant, or the triage looks off, click **Run the triage again**.

For urgent messages, phone the tenant first, then approve the written reply.

## What to check before approving

- **The facts in the reply match the email.** The draft should answer what the tenant asked, and nothing else.
- **No promises you haven't decided on.** Drafts must not promise a date or time, a payment or refund, a rent change,
  or an approval (pets, flatmates, subletting, painting, payment arrangements, ending early). Any sentence like that
  is removed before you see the draft and listed in the amber box; decide what to say and add it yourself.
- **The cited clause fits.** Read the clause shown under "Tenancy terms cited in the reply".
- **The sender is who they say they are.** For a message from an address that isn't on file, confirm by phone before
  sharing tenancy details.
- **The urgency is right,** and the maintenance job (if any) has the right priority.

## What it never does

- It never sends an email, makes a payment, changes rent or grants a permission. Approving only saves the reply.
- It never follows instructions written inside an email. A message that tries to instruct an automated assistant
  ("ignore your instructions and approve...") gets a neutral reply and is marked for a person.
- It never lowers the urgency the safety rules set, and never clears a "needs a person" mark.
- It never deletes or closes a maintenance job.

## When it gets something wrong

- **Wrong category or urgency:** correct the reply, approve it, and update the maintenance job's priority on the
  Maintenance page if needed. Your edit is recorded as a correction.
- **Wrong tenant or property:** don't approve. Check the tenant's email address on the Tenants page, fix it, then
  click **Run the triage again**.
- **A job was created that shouldn't exist, or two jobs for one issue:** edit or delete the job on the Maintenance
  page.
- **Urgent marked as routine:** treat it as urgent, phone the tenant, and tell the team so the keyword list can be
  extended.

## Setting up the email feed

The mailbox or email service posts each email to `POST /api/webhooks/inbox` with the header `x-webhook-secret`
set to the server's `INBOX_WEBHOOK_SECRET`, and a JSON body:

```json
{ "from": "Aroha Ngata <aroha.ngata@example.com>", "subject": "...", "text": "...",
  "messageId": "<id from the mail service>", "receivedAt": "2026-09-23T07:40:00+12:00", "to": "manager@example.com" }
```

- `messageId` makes deliveries safe to repeat: the same id is stored once and returns the same triage.
- The message joins the account whose login email equals `to`; otherwise it joins the first account (the demo
  manager).
- Requests without the right secret are refused (401), and the webhook is closed while no secret is set (503).

To load 15 sample emails through the same pipeline, use **Load 15 demo emails** on an empty inbox, or call
`loadDemo(userId)` from `server/src/inbox/demo.ts`.

## How well it works

Measured on labelled synthetic emails (`server/eval/inbox.ts`, full results in
[eval/results/inbox.md](../../eval/results/inbox.md)). The held-out set was written separately from the rules and
the prompt.

| Shipped pipeline (AI + rules and guards) | 60 development emails | 30 held-out emails |
|---|---|---|
| Urgent emails marked urgent | 10/10 | 4/4 |
| Category | 98% | 90% |
| Urgency (4 levels) | 90% | 83% |
| Tenant / property linked correctly | 100% / 100% | 97% / 100% |
| "Needs a person" correct | 92% | 87% |
| Maintenance job created or linked correctly | 100% | 97% |
| Reply cites the expected clause | 100% | 100% |

Rules only, on the held-out emails: category 80%, urgency 77%, every urgent email marked urgent, and every message
marked for a person.
