// Keyword rules for maintenance triage. They are the whole answer without a model, and the safety net with one:
// a safety pattern (gas, dangerous electrics, flooding, an unsecured home) always makes the request urgent, whatever
// the model says. Patterns are written for the words tenants use, in NZ, Australian, British and American English.
import { CATEGORY_LABELS, type Category, type RequestInput, type SafetyFlag, type TriageOutcome, type Urgency, maxUrgency } from './types'

interface Pattern {
  re: RegExp
  category: Category
  urgency: Urgency
  safety?: SafetyFlag
  why: string
}

// Order matters only within a safety flag group: the first safety match names the category.
const SAFETY_PATTERNS: Pattern[] = [
  { re: /\b(smell|smells|smelled|smelt|smelling|whiff|stink)\b[^.]{0,40}\bgas\b|\bgas\b[^.]{0,40}\b(smell|smells|smelling|leak|leaking|hiss|hissing)\b|\bgas leak\b|\bcarbon monoxide\b|\bco alarm\b/i, category: 'gas_heating', urgency: 'urgent', safety: 'gas', why: 'a gas smell or leak' },
  { re: /\b(spark|sparks|sparking|sparked|arcing|scorch|scorched|melting|melted|burning smell|smell of burning|smoke(?! (alarm|detector))|smoking|buzzing|crackling|electric shock|shocked me|got a shock|tingle|exposed wire|bare wire|wires? (hanging|exposed)|live wire)\b/i, category: 'electrical', urgency: 'urgent', safety: 'electrical', why: 'signs of an electrical fault that could cause a fire or shock' },
  { re: /\b(water|leak|leaking|dripping|drip)\b[^.]{0,60}\b(light|lights|light fitting|socket|power ?point|switch|fuse box|consumer unit|electrics|electrical|wiring)\b|\b(light|lights|light fitting|socket|power ?point|switch|electrics)\b[^.]{0,40}\b(water|wet|leak|dripping)\b/i, category: 'water_leak', urgency: 'urgent', safety: 'flooding', why: 'water near electrics' },
  { re: /\b(flood|flooded|flooding|burst pipe|pipe\b[^.]{0,40}\b(has |have |just )?burst|water (is )?(pouring|gushing|everywhere|coming through the ceiling|running down the wall)|ceiling (is )?(bulging|sagging|about to come down)|sewage|sewerage|overflowing (toilet|into the house)|raw sewage)\b/i, category: 'water_leak', urgency: 'urgent', safety: 'flooding', why: 'flooding or water damage happening now' },
  { re: /\b(?<!oven |cupboard |fridge |freezer |dishwasher |microwave |machine |wardrobe |cabinet )(door|doors|window|windows|gate|lock|house|flat|home|property)\b[^.]{0,30}\b(can'?t|cannot|won'?t|unable to|doesn'?t|does not|will not) (lock|secure|close|shut)\b|\b(can'?t|cannot|won'?t|unable to) (lock|secure) (the |my |our )?(door|house|flat|home|property|window|place)\b|\b(lock|door|window) (is|has been|was) (broken|smashed|kicked in|forced|jemmied)\b|\bbroke(n)? into\b|\bbreak-?in\b|\bburgl|\bintruder|\bsmashed (window|glass|the door)|\b(front|back|patio|sliding) door (won'?t|doesn'?t|will not) (lock|close|shut)|\block(ed)? out\b|\bno (way|means) to lock\b|\bwindow (won'?t|doesn'?t) (close|shut|lock)/i, category: 'security', urgency: 'urgent', safety: 'security', why: 'the home cannot be locked or secured' },
]

const CATEGORY_PATTERNS: Pattern[] = [
  // gas and heating (before plumbing, so a boiler with no hot water goes to the gas contractor)
  { re: /\bradiators?\b[^.]{0,40}\b(cold|bleed|bleeding|lukewarm)\b/i, category: 'gas_heating', urgency: 'normal', why: 'a radiator that needs bleeding or balancing' },
  { re: /\b(boiler|gas (hob|cooker|heater|fire|stove)|califont|infinity|gas hot water|radiators?|central heating|heating (has )?(stopped|not working|gone off)|no heating|pilot light|gas safety|cp12|gas cert)\b/i, category: 'gas_heating', urgency: 'high', why: 'a gas appliance or heating fault' },
  // plumbing
  { re: /\bno hot water\b|\bhot water (has )?(gone|stopped|not working)|\bcold (showers?|water only)\b/i, category: 'plumbing', urgency: 'high', why: 'no hot water' },
  { re: /\b(toilet|loo|cistern)\b[^.]{0,40}\b(blocked|won'?t flush|not flushing|overflow|running|leak|leaking|cracked)\b|\bonly toilet\b/i, category: 'plumbing', urgency: 'high', why: 'a toilet fault' },
  { re: /\bcompletely blocked\b|\bonly (one )?(bathroom|toilet|loo|shower)\b|\bwon'?t drain at all\b/i, category: 'plumbing', urgency: 'high', why: 'a blocked drain the household cannot do without' },
  { re: /\bblocked (drain|sink|shower|pipe|gully)\b|\b(drain|sink|shower|bath)\b[^.]{0,30}\b(blocked|not draining|draining slowly|backing up|gurgling)\b/i, category: 'plumbing', urgency: 'normal', why: 'a blocked drain' },
  { re: /\b(tap|faucet|mixer|shower ?head|cistern|ballcock|stopcock|plumbing|pipe|pipes|hot water|water pressure|washer|u-?bend|waste trap|basin)\b/i, category: 'plumbing', urgency: 'normal', why: 'a plumbing fault' },
  // water leaks (non-urgent)
  { re: /\b(roof|ceiling|skylight|gutter|downpipe|flashing)\b[^.]{0,50}\b(leak|leaking|drip|dripping|water (stain|mark|coming in)|damp patch)\b|\b(leak|leaking|water)\b[^.]{0,40}\b(roof|ceiling|skylight)\b/i, category: 'water_leak', urgency: 'high', why: 'water coming in through the roof or ceiling' },
  { re: /\b(damp|mould|mold|mildew|condensation|wet patch|water stain)\b/i, category: 'general', urgency: 'normal', why: 'damp or mould' },
  { re: /\bleak(ing|s)?\b/i, category: 'water_leak', urgency: 'high', why: 'a leak' },
  // electrical
  { re: /\b(keeps|constantly|always|still) (tripping|trips)\b|\btrips (every|each) time\b|\bno power\b|\bpower\b[^.]{0,30}\b(gone|cut|went off|is off|has gone)\b|\bmain switch\b/i, category: 'electrical', urgency: 'high', why: 'a power cut or a board that keeps tripping' },
  { re: /\b(power ?points?|sockets?|outlets?|light switch|switches|lights? (not working|flickering|stopped)|flickering|fuse|fuse box|breaker|consumer unit|rcd|tripping|tripped|trips|no power|power (has )?(gone|cut)|electrician|wiring|smoke alarm|smoke detector|extractor fan|ceiling fan|doorbell|security light)\b/i, category: 'electrical', urgency: 'normal', why: 'an electrical fault' },
  // security (non-urgent)
  { re: /\b(lost|missing) (my |the )?keys?\b|\bspare key|\bkey (snapped|broke|broken|stuck)|\block\b[^.]{0,20}\b(stiff|sticking|sticky|loose|jammed)\b|\bkey\b[^.]{0,20}\b(stuck|jams|jammed)\b|\bre-?key|\bchange the locks?|\bdeadbolt|\blatch\b|\bgarage door\b|\bintercom\b|\balarm (system|code)\b|\bsecurity\b/i, category: 'security', urgency: 'high', why: 'a lock or security fault' },
  // pests
  { re: /\b(rats?|mice|mouse|rodents?|wasps?|hornets?|bees?|bed ?bugs?|fleas?)\b/i, category: 'pest', urgency: 'high', why: 'rodents, stinging insects or biting insects' },
  { re: /\b(cockroach(es)?|roaches|ants?|flies|maggots|possums?|termites?|borer|silverfish|spiders?|pest|infestation|droppings|nest)\b/i, category: 'pest', urgency: 'normal', why: 'pests' },
  // appliances
  { re: /\b(fridge|freezer|refrigerator)\b[^.]{0,40}\b(died|dead|not working|stopped|broken|warm|defrost)/i, category: 'appliance', urgency: 'high', why: 'a fridge or freezer that has stopped' },
  { re: /\b(oven|stove|cooktop|hob|range|dishwasher|washing machine|washer|dryer|fridge|freezer|refrigerator|heat ?pump|air ?con|aircon|a\/c|microwave|rangehood|hot water cylinder|garbage disposal|waste disposal|appliance)\b/i, category: 'appliance', urgency: 'normal', why: 'an appliance fault' },
  // structural and grounds
  { re: /\b(fence|fencing|gate|deck|decking|steps?|stairs?|balustrade|handrail|railing|retaining wall|driveway|path|paving|roof tiles?|tiles? (slipped|missing|loose)|gutters?|downpipe|spouting|cladding|weatherboard|render|brick|chimney|window (frame|won'?t open|stuck|cracked|broken glass)|glass|glazing|door (handle|frame|hinge|sticking|swollen|won'?t open)|cupboard|wardrobe|drawer|shelf|floor ?boards?|carpet|tree|branch|hedge|lawn|garden|letterbox|clothesline|blind|curtain rail)\b/i, category: 'structural', urgency: 'low', why: 'a building or grounds repair' },
]

const RAISE = /\b((?<!not )urgent|urgently|(?<!not an )emergency|asap|as soon as possible|straight ?away|right away|immediately|(?<!not )dangerous|unsafe|not safe|gave way|collapsed|baby|newborn|toddler|elderly|disabled|pregnant|can'?t (stay|sleep) here)\b/i
const LOWER = /\b(no rush|not urgent|not an emergency|whenever|when (you|someone|it)('s| is)? (get|gets|next|convenient)|next time|next (visit|inspection)|cosmetic|minor|low priority|when convenient|at some point|sometime|can wait|not dangerous|just inconvenient)\b/i
const ACCESS = /((i'?m|i am|we'?re|we are|tenant is|someone('?s| is)) (home|in|around|available|here)[^.]*\.|(key|keys) (is|are) (in|with|under|at)[^.]*\.|(lockbox|key safe|spare key)[^.]*\.|(call|text|ring|message) (me|us|first|before)[^.]*\.|(after|before|from|between|until) \d{1,2}(:\d{2})? ?(am|pm)?[^.]*\.|(dog|cat|pets?) (is|are|will be)[^.]*\.|(working from home|wfh)[^.]*\.|(at work|out) (until|till|from|all day)[^.]*\.)/i

export interface RulesResult extends TriageOutcome {
  /** Which rule groups fired, for the evaluation. */
  matched: { safety: string[]; category: string[] }
}

const sentence = (s: string) => s.trim().replace(/\s+/g, ' ')

const cleanGreeting = (s: string) =>
  s
    .replace(/^\s*(hi|hello|hey|kia ora|good (morning|afternoon|evening))\b( there\b(?!'))?( team| all| guys)?[,!. ]*/i, '')
    .replace(/^(just|so|um|ok|okay)[, ]+/i, '')
    .trim()

/** A short title for the job list: the first sentence of the request that says something, tidied. */
export function titleFor(text: string, category: Category): string {
  const sentences = sentence(text).split(/[.!?\n]/)
  const cleaned = cleanGreeting(sentences.find((s) => cleanGreeting(s).length > 8) ?? sentences[0] ?? '')
  const title = cleaned.length > 8 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : CATEGORY_LABELS[category]
  return title.length > 70 ? `${title.slice(0, 67).trimEnd()}...` : title
}

export function accessNotesFrom(text: string): string | null {
  const m = text.match(ACCESS)
  return m ? sentence(m[0]).replace(/\.$/, '') : null
}

/** Triage by the rules alone. */
export function triageByRules(input: RequestInput): RulesResult {
  const text = [input.text, input.photoNote ?? ''].join('\n')
  const matched = { safety: [] as string[], category: [] as string[] }
  const safety: SafetyFlag[] = []
  const reasons: string[] = []
  let category: Category | null = null
  let urgency: Urgency = 'normal'

  for (const p of SAFETY_PATTERNS) {
    if (p.re.test(text)) {
      matched.safety.push(p.safety!)
      if (!safety.includes(p.safety!)) safety.push(p.safety!)
      if (!category) category = p.category
      urgency = 'urgent'
      reasons.push(`Flagged as urgent: ${p.why}.`)
    }
  }
  if (!category) {
    for (const p of CATEGORY_PATTERNS) {
      if (p.re.test(text)) {
        matched.category.push(p.category)
        if (!category) {
          category = p.category
          urgency = p.urgency
          reasons.push(`Looks like ${p.why}.`)
        }
      }
    }
  }
  if (!category) {
    category = 'general'
    reasons.push('No specific fault recognised, so it is listed as a general repair for a person to classify.')
  }
  if (!safety.length) {
    if (RAISE.test(text)) {
      urgency = maxUrgency(urgency, 'high')
      reasons.push('The tenant asked for it to be treated as urgent, or mentioned someone vulnerable.')
    } else if (LOWER.test(text) && urgency !== 'urgent') {
      urgency = urgency === 'high' ? 'normal' : 'low'
      reasons.push('The tenant said it can wait.')
    }
  }
  const accessNotes = accessNotesFrom(input.text)
  return {
    category,
    urgency,
    safety,
    summary: titleFor(input.text, category),
    reasons,
    scope: `${CATEGORY_LABELS[category]}: ${sentence(input.text).slice(0, 300)}${input.photoNote ? ` Photo: ${sentence(input.photoNote)}` : ''}`,
    accessNotes,
    method: 'rules',
    model: { calls: 0, live: 0, cached: 0, latencyMs: 0, error: null },
    matched,
  }
}
