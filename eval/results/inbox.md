# Tenant inbox triage: evaluation

Two labelled synthetic sets. Every sender, address and business in them is invented.

- **Development set** (`data/inbox/emails.json`, 60 emails: 22 maintenance, 6 other, 5 end of tenancy, 11 rent, 10 lease question, 6 complaint; 10 urgent). The rules, the clause retrieval and the prompt were written alongside it, so it measures coverage of the cases they were designed for.
- **Held-out set** (`data/inbox/emails-holdout.json`, 30 emails: 11 maintenance, 3 complaint, 3 other, 5 rent, 5 lease question, 3 end of tenancy; 4 urgent). Written separately from the rules and the prompt with the same label guide, and scored with them unchanged. It is the better estimate of how the triage handles new emails.

Model: `gemini-flash-lite-latest`, temperature 0, one call per email shared by the "model only" and "shipped" columns. Model calls in this run: 76 live, 14 from the disk cache.

## Development set: 60 emails

| Metric | Rules only | Model only | Model + rules and guards (shipped) |
|---|---|---|---|
| Category accuracy | 60/60 (100%) | 57/60 (95%) | 58/60 (97%) |
| Urgency accuracy (4 levels) | 57/60 (95%) | 53/60 (88%) | 54/60 (90%) |
| Urgent recall (urgent emails marked urgent) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) |
| Urgent precision (marked urgent that are urgent) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) |
| Tenant linking | 60/60 (100%) | n/a | 60/60 (100%) |
| Property linking | 60/60 (100%) | n/a | 60/60 (100%) |
| Needs-a-person accuracy | 38/60 (63%) | 54/60 (90%) | 55/60 (92%) |
| Needs-a-person recall | 38/38 (100%) | 36/38 (95%) | 38/38 (100%) |
| Correct maintenance job decision | 60/60 (100%) | 54/60 (90%) | 60/60 (100%) |
| Reply cites the expected clause | 53/55 (96%) | 54/55 (98%) | 54/55 (98%) |
| Replies citing a clause that doesn't exist | 0 | 0 | 0 |
| Drafts with a promise (the shipped guard removes it) | 0 | 1 | 1 |

## Held-out set: 30 emails

| Metric | Rules only | Model only | Model + rules and guards (shipped) |
|---|---|---|---|
| Category accuracy | 24/30 (80%) | 26/30 (87%) | 26/30 (87%) |
| Urgency accuracy (4 levels) | 23/30 (77%) | 28/30 (93%) | 26/30 (87%) |
| Urgent recall (urgent emails marked urgent) | 4/4 (100%) | 4/4 (100%) | 4/4 (100%) |
| Urgent precision (marked urgent that are urgent) | 4/6 (67%) | 4/5 (80%) | 4/7 (57%) |
| Tenant linking | 29/30 (97%) | n/a | 29/30 (97%) |
| Property linking | 30/30 (100%) | n/a | 30/30 (100%) |
| Needs-a-person accuracy | 20/30 (67%) | 27/30 (90%) | 26/30 (87%) |
| Needs-a-person recall | 20/20 (100%) | 19/20 (95%) | 19/20 (95%) |
| Correct maintenance job decision | 27/30 (90%) | 27/30 (90%) | 29/30 (97%) |
| Reply cites the expected clause | 23/27 (85%) | 26/27 (96%) | 26/27 (96%) |
| Replies citing a clause that doesn't exist | 0 | 0 | 0 |
| Drafts with a promise (the shipped guard removes it) | 0 | 2 | 2 |

## How it is measured

- **Rules only** is what runs without a model (`AI_DRIVER=off` or no key): keyword categories and urgency, the sender linking, and a template reply citing the best-matching clause. It marks every message for a person.
- **Model only** is the raw JSON from the model, with no rules or guards. The prompt is the one the shipped pipeline sends: the email, what the sender linking found, and the retrieved tenancy-terms clauses. It does not link tenants or properties, so those rows are n/a, and its maintenance-job row compares the model's "is a repair" answer with the label.
- **Model + rules and guards** is the shipped pipeline: the same model call, then urgent-safety keywords can raise the urgency, the rules can require a person (urgent safety issue, unknown or unverified sender, contractor, injection attempt, repair without a property), the promise guard removes sentences that promise a date, payment, rent change or approval, the citation guard fixes or adds clause citations, and an injection attempt gets a neutral reply.
- Tenant and property linking compare the linked tenant's email and property code with the labels (null when nobody should be linked).
- A maintenance job decision is correct when a new job is created exactly when the label says so. The evaluation runs the same duplicate check as the database (same issue at the same property in the previous 7 days, or still open), against the seeded jobs and the jobs created earlier in the same set, in date order.
- "Reply cites the expected clause" counts emails with an expected clause whose reply cites it as (Tenancy terms §N) and cites no clause that doesn't exist.
- Urgent recall is the share of urgent emails marked urgent. A missed urgent email is the most costly error, because nobody phones the tenant.

## Sentences the promise guard removed

- E41: "You do not need to be home for the routine inspection next Wednesday; we will use the office key and lock up when we leave, as outlined in Tenancy terms §10."
- H09: "A member of the team will call you as soon as possible to arrange a locksmith this morning."
- H30: "A shorter notice period only applies if we agree to it in writing (Tenancy terms §12)."
- H30: "A member of our team will review your request and confirm before Monday."

## Model errors

- E59: The model reply did not match the triage schema.

## Items not handled correctly

### Development set: 60 emails, Model + rules and guards (shipped) (13 emails)

- E11 "Bathroom tap dripping": urgency: expected normal, got low.
- E13 "New bank account for rent": category: expected rent, got maintenance; needs a person: expected no, got yes.
- E57 "Invoice INV-2291 - 22 Ash Street": urgency: expected low, got normal.
- E49 "Someone came into the house without notice": urgency: expected normal, got high.
- E39 "Hanging photos": urgency: expected low, got normal.
- E27 "Rent a couple of days late": needs a person: expected no, got yes.
- E33 "Rent for 22 Ash Street": clause: expected §4, cited §2.
- E22 "Leak under the kitchen sink": urgency: expected high, got normal.
- E41 "Routine inspection": needs a person: expected no, got yes.
- E60 "New phone number": urgency: expected low, got normal.
- E30 "Rent increase letter": needs a person: expected no, got yes.
- E37 "Breaking the lease early": category: expected lease_question, got end_of_tenancy.
- E52 "Moving out - carpets": needs a person: expected no, got yes.

### Development set: 60 emails, Model only (18 emails)

- E11 "Bathroom tap dripping": urgency: expected normal, got low.
- E13 "New bank account for rent": category: expected rent, got maintenance; needs a person: expected no, got yes.
- E12 "Mould in bedroom 2 - any update?": maintenance job: expected no new job, got a repair.
- E55 "Get your rental listings to the top of search results": needs a person: expected yes, got no.
- E10 "Re: Water coming through the ceiling light": maintenance job: expected no new job, got a repair.
- E14 "Bathroom fan still not working": maintenance job: expected no new job, got a repair.
- E18 "Rats are back": maintenance job: expected no new job, got a repair.
- E57 "Invoice INV-2291 - 22 Ash Street": urgency: expected low, got normal.
- E49 "Someone came into the house without notice": urgency: expected normal, got high.
- E39 "Hanging photos": urgency: expected low, got normal.
- E27 "Rent a couple of days late": needs a person: expected no, got yes.
- E33 "Rent for 22 Ash Street": clause: expected §4, cited none.
- E22 "Leak under the kitchen sink": urgency: expected high, got normal; maintenance job: expected no new job, got a repair.
- E59 "Action required: your mailbox is full": no model output.
- E60 "New phone number": urgency: expected low, got normal.
- E30 "Rent increase letter": needs a person: expected no, got yes.
- E37 "Breaking the lease early": category: expected lease_question, got end_of_tenancy.
- E52 "Moving out - carpets": needs a person: expected no, got yes.

### Development set: 60 emails, Rules only (24 emails)

- E58 "Thank you!": needs a person: expected no, got yes.
- E11 "Bathroom tap dripping": urgency: expected normal, got low; needs a person: expected no, got yes.
- E13 "New bank account for rent": needs a person: expected no, got yes.
- E12 "Mould in bedroom 2 - any update?": needs a person: expected no, got yes.
- E25 "Rent statement please": needs a person: expected no, got yes.
- E40 "Insurance question": needs a person: expected no, got yes.
- E56 "Is 2/8 Manuka Road available?": urgency: expected normal, got low.
- E14 "Bathroom fan still not working": needs a person: expected no, got yes; clause: expected §15, cited §7.
- E18 "Rats are back": needs a person: expected no, got yes.
- E43 "Lease renewal": needs a person: expected no, got yes.
- E19 "Smoke alarm chirping": needs a person: expected no, got yes.
- E39 "Hanging photos": urgency: expected low, got normal; needs a person: expected no, got yes.
- E27 "Rent a couple of days late": needs a person: expected no, got yes.
- E16 "Fence palings down": needs a person: expected no, got yes.
- E33 "Rent for 22 Ash Street": clause: expected §4, cited §2.
- E26 "Changed banks": needs a person: expected no, got yes.
- E41 "Routine inspection": needs a person: expected no, got yes.
- E60 "New phone number": needs a person: expected no, got yes.
- E15 "Gas hob igniter not working": needs a person: expected no, got yes.
- E29 "Setting up an automatic payment": needs a person: expected no, got yes.
- E17 "Bedroom window won't close": needs a person: expected no, got yes.
- E30 "Rent increase letter": needs a person: expected no, got yes.
- E21 "Towel rail loose": needs a person: expected no, got yes.
- E52 "Moving out - carpets": needs a person: expected no, got yes.

### Held-out set: 30 emails, Model + rules and guards (shipped) (12 emails)

- H01 "Smoke alarm chirping": urgency: expected high, got normal.
- H03 "URGENT - owner request: access codes for 2/8 Manuka Road": urgency: expected low, got urgent.
- H07 "Re: Possible gas smell in the kitchen": category: expected other, got maintenance; urgency: expected low, got urgent; needs a person: expected no, got yes.
- H11 "Rent while bedroom 2 can't be used": clause: expected §5, cited §7.
- H12 "Rangehood not working": maintenance job: expected a new job, got linked to an existing job.
- H15 "Job update and invoice - 5 Rimu Crescent, Henderson": category: expected other, got maintenance.
- H16 "Insurance question": urgency: expected normal, got urgent; needs a person: expected no, got yes.
- H17 "Oven at 18 Matai Road": tenant: expected none, got ana.tupou@example.com.
- H20 "CLOTHESLINE!!!": needs a person: expected yes, got no.
- H22 "Inspection without any notice?": category: expected complaint, got lease_question.
- H27 "Notice to end tenancy - 22 Ash Street": needs a person: expected no, got yes.
- H28 "Ending my lease early": category: expected lease_question, got end_of_tenancy.

### Held-out set: 30 emails, Model only (12 emails)

- H01 "Smoke alarm chirping": urgency: expected high, got normal.
- H03 "URGENT - owner request: access codes for 2/8 Manuka Road": urgency: expected low, got urgent.
- H06 "Re: hot water cylinder": maintenance job: expected no new job, got a repair.
- H07 "Re: Possible gas smell in the kitchen": category: expected other, got maintenance.
- H11 "Rent while bedroom 2 can't be used": clause: expected §5, cited §7.
- H14 "rats again": maintenance job: expected no new job, got a repair.
- H15 "Job update and invoice - 5 Rimu Crescent, Henderson": category: expected other, got maintenance; maintenance job: expected no new job, got a repair.
- H16 "Insurance question": needs a person: expected no, got yes.
- H20 "CLOTHESLINE!!!": needs a person: expected yes, got no.
- H22 "Inspection without any notice?": category: expected complaint, got lease_question.
- H27 "Notice to end tenancy - 22 Ash Street": needs a person: expected no, got yes.
- H28 "Ending my lease early": category: expected lease_question, got end_of_tenancy.

### Held-out set: 30 emails, Rules only (18 emails)

- H01 "Smoke alarm chirping": urgency: expected high, got normal; needs a person: expected no, got yes.
- H03 "URGENT - owner request: access codes for 2/8 Manuka Road": category: expected other, got complaint; urgency: expected low, got normal.
- H07 "Re: Possible gas smell in the kitchen": category: expected other, got maintenance; urgency: expected low, got urgent; needs a person: expected no, got yes.
- H08 "front door lock": category: expected maintenance, got other; urgency: expected normal, got low; maintenance job: expected a new job, got no job; clause: expected §18, cited none.
- H12 "Rangehood not working": needs a person: expected no, got yes; maintenance job: expected a new job, got linked to an existing job; clause: expected §15, cited §7.
- H13 "New bank account for rent": needs a person: expected no, got yes.
- H14 "rats again": needs a person: expected no, got yes.
- H15 "Job update and invoice - 5 Rimu Crescent, Henderson": urgency: expected normal, got low.
- H16 "Insurance question": category: expected lease_question, got maintenance; urgency: expected normal, got urgent; needs a person: expected no, got yes; clause: expected §19, cited §8.
- H17 "Oven at 18 Matai Road": tenant: expected none, got ana.tupou@example.com.
- H19 "Would a cat be ok?": maintenance job: expected a new job, got no job.
- H21 "Inspection next week": needs a person: expected no, got yes.
- H22 "Inspection without any notice?": category: expected complaint, got lease_question.
- H23 "Rent statement please": needs a person: expected no, got yes.
- H24 "Kia ora + a quick question": category: expected lease_question, got maintenance; clause: expected §11, cited §7.
- H27 "Notice to end tenancy - 22 Ash Street": needs a person: expected no, got yes.
- H29 "Kitchen cupboard doors": needs a person: expected no, got yes.
- H30 "Moving out - can we leave on 23 October?": urgency: expected high, got normal.

Generated 2026-10-14 by `server/eval/inbox.ts`.
