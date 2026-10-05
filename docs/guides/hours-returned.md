# Staff guide: the hours-returned report

**Who it's for:** the operations lead and the owners, once a month.

**What it shows:** how much manual time the automations saved in a month, after counting the time people spent
checking the automations' work, with the method on the same page.

## Read it

1. Open **Hours returned** in the sidebar and pick the month.
2. The headline is the hours returned. Under it are the items handled, the time those items would have taken by
   hand, and the time spent reviewing.
3. The table splits this by automation and shows how each item ended:
   - handled automatically;
   - approved as is;
   - corrected, then approved;
   - rejected or failed.
4. **Download CSV** gives the same table for an owner report or a spreadsheet.

## How the number is counted

```
hours returned = baseline minutes for items whose automated work was used - minutes spent reviewing
```

- **Baseline minutes per item** come from the discovery timings ([discovery/task-timings.csv](../../discovery/task-timings.csv)):

  | Task | Minutes by hand |
  |---|---|
  | Tenant email | 6 |
  | Supplier invoice | 12 |
  | Lease summary | 25 |
  | Bank line | 3 |

- **Review time** is measured in the app, from opening an item to approving, correcting or rejecting it.
- **Rejected or failed items earn nothing.** A person did that task by hand, and the review time still counts
  against the total.

## Check before you share it

- **Unusually high returns:** compare the item counts with the month's real volume, such as the number of bank
  lines on the statement.
- **Long review times:** a large review figure for one automation usually means its inputs changed, for example a
  supplier with a new invoice layout. That's worth a look before next month.
- **When the timings are wrong:** if the way a task is done by hand changes, update the discovery timings and the
  baseline in `server/src/lib/automation.ts` together. A test fails if they disagree.

## What it never does

- It never estimates. Every item counted is a real row created when an automation handled something.
- Time is never credited for work a person redid.

## Model usage

The panel beside the method lists the month's model calls per feature: the calls, how many came from the cache,
the failures and the median latency. A failure there means that feature fell back to its rules for that item.
