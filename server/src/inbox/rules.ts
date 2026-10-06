// Keyword rules for the tenant inbox. They always run, with or without a model:
// - urgent safety signals (gas, flooding, sparking, sewage, a home that can't be locked, ...) force urgency "urgent";
// - instruction-injection patterns and unknown senders force a person's check;
// - in rules-only mode they also choose the category and urgency.
import { CATEGORIES, type Category, type Urgency } from './types'

export interface SafetySignal {
  key: string
  label: string
}

const HEATING_FAILURE =
  /\b(no heat(ing)?|heat ?pump|heater|heating)\b[^.!?]{0,60}\b(stopped|not working|isn'?t working|won'?t (turn on|work)|broken|died|failed)\b|\b(no heat(ing)?)\b/i
const VULNERABLE = /\b(baby|babies|newborn|infant|\d+[- ]months?[- ]old|elderly|asthma|unwell|sick|disabled|pregnant)\b/i

const SAFETY_RULES: { key: string; label: string; test: (text: string) => boolean }[] = [
  {
    key: 'gas',
    label: 'a smell of gas',
    test: (t) => /\b(smell(s|ing)? (of |like )?gas|gas (smell|leak)|leaking gas|gassy smell)\b/i.test(t),
  },
  {
    key: 'flooding',
    label: 'flooding or a burst pipe',
    test: (t) =>
      /\b(burst (pipe|hose|main|cylinder)|pipe (has |had )?burst|has burst|flood(ed|ing)?|water (is )?(pouring|gushing|spraying|everywhere)|pouring (out|in|through))\b/i.test(t),
  },
  {
    key: 'electrical',
    label: 'sparking or burning electrics',
    test: (t) =>
      /\b(spark(s|ing|ed)?|burning smell|smell of burning|scorch(ed|ing)?|electric(al)? shock|exposed wires?|live wires?)\b/i.test(t) ||
      /\bcrackl(e|es|ing)\b[^.!?]{0,80}\b(power point|socket|plug|switch|jug)\b|\b(power point|socket|plug|switch)\b[^.!?]{0,80}\bcrackl/i.test(t),
  },
  {
    key: 'water_electrics',
    label: 'water near electrics',
    test: (t) => /\b(water|leak\w*|drip\w*)\b[^.!?]{0,60}\b(light fitting|light|switch|power point|socket|switchboard|wiring)\b/i.test(t),
  },
  {
    key: 'fire',
    label: 'fire or smoke',
    test: (t) => /\b(on fire|caught fire|flames|smoke (is )?(coming|pouring|billowing) (from|out of))\b/i.test(t),
  },
  {
    key: 'no_hot_water',
    label: 'no hot water',
    test: (t) => /\bno hot water\b|\bhot water (has )?(stopped|gone|isn'?t working|is not working|not working)\b/i.test(t),
  },
  {
    key: 'sewage',
    label: 'sewage or an overflowing toilet',
    test: (t) => /\b(sewage|sewer|toilet (is )?(overflowing|backing up)|backing up and overflowing)\b/i.test(t),
  },
  {
    key: 'security',
    label: "a home that can't be secured",
    test: (t) =>
      /\b(break-?in|broke in(to)?|broken into|burglar(y|ised|ized)?|burgled)\b/i.test(t) ||
      /\b(can'?t|cannot|won'?t|unable to) (lock|secure)\b|\block (is |was )?(broken|smashed)\b/i.test(t),
  },
  {
    key: 'no_heat_vulnerable',
    label: 'no heating with a baby or vulnerable person',
    test: (t) => HEATING_FAILURE.test(t) && VULNERABLE.test(t),
  },
  { key: 'structural', label: 'a ceiling or structure at risk', test: (t) => /\bceiling (has )?(collapsed|caving|sagging|falling)\b/i.test(t) },
  { key: 'carbon_monoxide', label: 'carbon monoxide', test: (t) => /\bcarbon monoxide\b/i.test(t) },
]

/** Urgent safety signals in the subject and body. Any signal makes the message urgent and needs a person. */
export function safetySignals(subject: string, text: string): SafetySignal[] {
  const all = `${subject}\n${text}`
  return SAFETY_RULES.filter((r) => r.test(all)).map(({ key, label }) => ({ key, label }))
}

const INJECTION_PATTERNS: RegExp[] = [
  /\bignore (all |any )?(of )?(your|the|my|previous|prior|above|earlier|these|those)?\s*(previous |prior |earlier |system )?(instructions|rules|guidelines|prompts?)\b/i,
  /\bdisregard (all |any )?(of )?(your|the|previous|prior|above|earlier)?\s*(previous |prior |system )?(instructions|rules|guidelines)\b/i,
  /\b(instructions?|note|message|command)s? (for|to) (the |any )?(ai|a\.i\.|assistant|bot|chatbot|model|language model|automated system)\b/i,
  /\b(you are now|from now on,? you|pretend (to be|you are)|act as (an?|the) |new instructions|system prompt|developer mode|jailbreak)\b/i,
  /\b(reveal|print|repeat|show) (your|the) (prompt|instructions|system message)\b/i,
]

/** Phrases that try to instruct an automated assistant. A match always needs a person and gets a neutral reply. */
export function injectionMatches(subject: string, text: string): string[] {
  const all = `${subject}\n${text}`
  const hits: string[] = []
  for (const re of INJECTION_PATTERNS) {
    const m = all.match(re)
    if (m) hits.push(m[0])
  }
  return hits
}

// Category keywords with weights. A subject match counts double.
const CATEGORY_RULES: Record<Category, [RegExp, number][]> = {
  maintenance: [
    [/\b(leak|leaks|leaking)\b/, 2],
    [/\bdrip(s|ping)?\b/, 2],
    [/\bburst\b/, 2],
    [/\bflood(ed|ing)?\b/, 2],
    [/\bbroken\b/, 1],
    [/\b(not|isn'?t|stopped|won'?t|doesn'?t) (working|work|turn on|close|lock|drain|draining|clicking|flush)\b/, 2],
    [/\b(repair|fix|fixed|fixing)\b/, 1],
    [/\b(faulty|blocked)\b/, 1],
    [/\bspark(s|ed|ing)?\b|\bcrackl/, 2],
    [/\bburning smell\b|\bscorch/, 2],
    [/\bmou?ld\b|\bcondensation\b/, 2],
    [/\brats?\b|\bmice\b|\brodents?\b|\bdroppings\b|\bcockroach/, 2],
    [/\bhot water\b|\bcylinder\b/, 2],
    [/\bheat ?pump\b|\bheater\b|\bheating\b/, 1],
    [/\bsmoke alarm\b|\bchirp/, 2],
    [/\bpower point\b|\bsocket\b/, 2],
    [/\bextractor\b|\bfan\b/, 1],
    [/\b(oven|hob|stove|igniter|dishwasher)\b/, 2],
    [/\b(toilet|sewage|drain)\b/, 2],
    [/\b(taps?|pipes?|sink|plumber)\b/, 1],
    [/\bceiling\b|\blight fitting\b/, 1],
    [/\blatch\b|\bhandle\b/, 1],
    [/\bwindow\b/, 1],
    [/\b(fence|palings|gate)\b/, 2],
    [/\btowel rail\b/, 2],
    [/\bgas\b/, 1],
    [/\belectrician\b|\btradesperson\b/, 1],
    [/\bbreak-?in\b|\bbroke into\b/, 1],
  ],
  rent: [
    [/\brent\b/, 1],
    [/\bpay(ment|ments|ing)?\b|\bpaid\b/, 1],
    [/\bautomatic payment\b/, 2],
    [/\bbanks?\b/, 2],
    [/\baccount\b/, 1],
    [/\breference\b/, 1],
    [/\breceipts?\b|\bstatement\b/, 2],
    [/\barrears\b|\bbehind\b/, 2],
    [/\blate\b/, 1],
    [/\boverpa|\bpaid twice\b|\bwent through twice\b/, 2],
    [/\bfortnightly\b/, 2],
    [/\brent (increase|reduction|decrease|review)\b|\bgoing up\b/, 2],
    [/\bhours\b[^.]{0,30}\bcut\b|\bhardship\b/, 2],
  ],
  lease_question: [
    [/\bpets?\b|\bcats?\b|\bpupp(y|ies)\b|\bkittens?\b/, 2],
    [/\bsub-?let|\bshort-term\b|\bholiday[- ]rental/, 3],
    [/\bpaint(ing)?\b/, 2],
    [/\bhooks?\b/, 2],
    [/\bflatmate/, 3],
    [/\bguests?\b|\bstay with us\b|\bwh[āa]nau\b/, 2],
    [/\binsurance\b/, 3],
    [/\binspection\b/, 1],
    [/\bbreak(ing)? (the|my|our) lease\b|\bfixed[- ]term\b/, 3],
    [/\brolls? over\b|\brenew|\blease anniversary\b/, 3],
    [/\b(allowed|permitted)\b|\bwould it be (ok|okay|alright)\b|\bis it (ok|okay)\b/, 2],
    [/\bdo (i|we) need to\b/, 1],
    [/\blease\b/, 1],
  ],
  complaint: [
    [/\bnois(e|y)\b|\bloud\b|\bmusic\b/, 2],
    [/\bpart(y|ies)\b/, 2],
    [/\bneighbou?rs?\b|\bnext door\b|\bupstairs\b/, 2],
    [/\bbark(s|ing)?\b/, 2],
    [/\bsmokes\b|\bcigarette\b/, 2],
    [/\bshout(ed|ing)?\b|\bthreat|\bscared\b/, 2],
    [/\bunacceptable\b|\bnot ok\b|\bfed up\b|\bridiculous\b|\bfrustrat|\bdisappointed\b/, 2],
    [/\bcomplain/, 2],
    [/\bwithout (notice|telling)\b|\bnobody told me\b/, 2],
    [/\bdeal with it\b|\bdo something about\b/, 1],
  ],
  end_of_tenancy: [
    [/\bgive notice\b|\bnotice to end\b|\bend(ing)? (our|my|the) tenancy\b/, 3],
    [/\bmov(e|ed|ing) out\b/, 3],
    [/\blast day\b/, 2],
    [/\bfinal inspection\b/, 3],
    [/\bbond\b/, 2],
    [/\bcarpets?\b/, 1],
    [/\bkeys\b/, 1],
    [/\bleave in\b|\bleaving\b|\bneed to leave\b/, 2],
  ],
  other: [
    [/\bunsubscribe\b|\breply stop\b/, 3],
    [/\bsearch results\b|\blistings\b|\bguaranteed\b|\bfree audit\b/, 2],
    [/\bmailbox\b|\bpassword\b|\bclick the link\b|\bsign in\b/, 3],
    [/\binvoice\b/, 3],
    [/\bviewing\b|\bavailable to rent\b/, 3],
    [/\bthank(s| you) for\b[^.]{0,60}\b(sorting|sending|fixing|getting)\b|\blooks great\b|\bmuch appreciated\b/, 3],
    [/\bphone number\b|\bmobile number\b|\bupdate (your|my) records\b/, 3],
  ],
}

// On a tie the earlier category wins.
const TIE_ORDER: Category[] = ['maintenance', 'rent', 'end_of_tenancy', 'lease_question', 'complaint', 'other']

export function categoryScores(subject: string, text: string): Record<Category, number> {
  const s = subject.toLowerCase()
  const b = text.toLowerCase()
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  for (const category of CATEGORIES) {
    for (const [re, weight] of CATEGORY_RULES[category]) {
      if (re.test(s)) scores[category] += 2 * weight
      if (re.test(b)) scores[category] += weight
    }
  }
  return scores
}

export function categorise(scores: Record<Category, number>): Category {
  let best: Category = 'other'
  let bestScore = 0
  for (const category of TIE_ORDER) {
    if (scores[category] > bestScore) {
      best = category
      bestScore = scores[category]
    }
  }
  return best
}

const HIGH_PATTERNS: Partial<Record<Category, RegExp>> = {
  maintenance: /\bleak|\bsoaked\b|\bdroppings\b|\bpantry\b|\bwon'?t close\b|\bno heat|\bonly toilet\b/i,
  rent: /\bhours\b[^.]{0,30}\bcut\b|\bwon'?t be able to pay\b|\bcan'?t pay\b|\bcannot pay\b|\bhardship\b|\blost my job\b/i,
  complaint: /\bthreat|\bscared\b|\bviolen|\bpolice\b|\bunsafe\b/i,
}
const LOW_PATTERN = /\blow priority\b|\bnot urgent\b|\bno rush\b|\bno hurry\b/i

/** Rules-only urgency: safety signals first, then category heuristics. */
export function rulesUrgency(category: Category, subject: string, text: string, safety: SafetySignal[]): Urgency {
  if (safety.length > 0) return 'urgent'
  if (category === 'other') return 'low'
  const all = `${subject}\n${text}`
  if (HIGH_PATTERNS[category]?.test(all)) return 'high'
  if (LOW_PATTERN.test(all)) return 'low'
  return 'normal'
}

/** Rules-only maintenance detection: the category, a strong secondary repair topic, or any urgent safety signal. */
export function rulesIsMaintenance(category: Category, scores: Record<Category, number>, safety: SafetySignal[]): boolean {
  if (safety.length > 0) return true
  if (category === 'maintenance') return true
  return category !== 'other' && scores.maintenance >= 4
}
