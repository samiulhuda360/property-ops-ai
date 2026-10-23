# Maintenance triage: evaluation

60 labelled tenant requests across the two demo companies (40 used while writing the rules and prompt, 20 held out). Each is labelled with a category, an urgency and the safety flags that apply. Model: `gemini-flash-lite-latest`. The shipped route lets the model classify and write the scope while the rules keep the safety net: a safety pattern always makes the request urgent.

## All 60 requests (60)

| Metric | Rules | Model | Model + rules (shipped) |
|---|---|---|---|
| Category correct | 96.7% (58/60) | 95.0% (57/60) | 95.0% (57/60) |
| Urgency correct | 88.3% (53/60) | 86.7% (52/60) | 85.0% (51/60) |
| Safety cases flagged urgent | 82.6% (19/23) | 100.0% (23/23) | 100.0% (23/23) |
| Safety flags: precision / recall | 95.0% / 79.2% | 82.8% / 100.0% | 80.0% / 100.0% |
| Non-safety requests wrongly made urgent | 1 | 4 | 5 |
| Median time per request | 0 ms | 1 ms | 1 ms |

## Development set (40)

| Metric | Rules | Model | Model + rules (shipped) |
|---|---|---|---|
| Category correct | 100.0% (40/40) | 97.5% (39/40) | 97.5% (39/40) |
| Urgency correct | 97.5% (39/40) | 85.0% (34/40) | 87.5% (35/40) |
| Safety cases flagged urgent | 100.0% (14/14) | 100.0% (14/14) | 100.0% (14/14) |
| Safety flags: precision / recall | 100.0% / 100.0% | 77.8% / 100.0% | 77.8% / 100.0% |
| Non-safety requests wrongly made urgent | 0 | 3 | 3 |
| Median time per request | 0 ms | 1 ms | 1 ms |

## Held-out set (20)

| Metric | Rules | Model | Model + rules (shipped) |
|---|---|---|---|
| Category correct | 90.0% (18/20) | 90.0% (18/20) | 90.0% (18/20) |
| Urgency correct | 70.0% (14/20) | 90.0% (18/20) | 80.0% (16/20) |
| Safety cases flagged urgent | 55.6% (5/9) | 100.0% (9/9) | 100.0% (9/9) |
| Safety flags: precision / recall | 83.3% / 50.0% | 90.9% / 100.0% | 83.3% / 100.0% |
| Non-safety requests wrongly made urgent | 1 | 1 | 2 |
| Median time per request | 0 ms | 1 ms | 1 ms |

## Calls and cost

| Route | Live calls | Cached calls | Input tokens | Output tokens | Cost per request at list price |
|---|---|---|---|---|---|
| Rules | 0 | 0 | 0 | 0 | $0.0000 |
| Model | 0 | 60 | 32444 | 8321 | $0.0001 |
| Model + rules (shipped) | 0 | 60 | 32444 | 8321 | $0.0001 |

Cost uses the tokens the API reported at $0.1 per million input tokens and $0.4 per million output tokens.

## Requests not fully correct

- Rules: M29 urgency
- Rules: M44 urgency
- Rules: M45 category urgency
- Rules: M46 urgency
- Rules: M51 urgency
- Rules: M52 urgency
- Rules: M57 category urgency
- Model: M17 urgency
- Model: M18 category
- Model: M19 urgency
- Model: M23 urgency
- Model: M26 urgency
- Model: M38 urgency
- Model: M39 urgency
- Model: M47 urgency
- Model: M48 urgency
- Model: M49 category
- Model: M53 category
- Model + rules (shipped): M17 urgency
- Model + rules (shipped): M18 category
- Model + rules (shipped): M23 urgency
- Model + rules (shipped): M26 urgency
- Model + rules (shipped): M38 urgency
- Model + rules (shipped): M39 urgency
- Model + rules (shipped): M46 urgency
- Model + rules (shipped): M47 urgency
- Model + rules (shipped): M48 urgency
- Model + rules (shipped): M49 category
- Model + rules (shipped): M53 category
- Model + rules (shipped): M57 urgency

