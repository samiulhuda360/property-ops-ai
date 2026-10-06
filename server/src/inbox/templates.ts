// Template replies for rules-only mode, and the neutral reply used when an email tries to instruct the assistant.
// Templates never promise a date, a payment, a rent change or an approval; the promise guard checks them in tests.
import type { SafetySignal } from './rules'
import { citation, getClause } from './terms'
import type { Category } from './types'

const OPENING: Record<Category, string> = {
  maintenance: "Thank you for reporting this. We've logged it as a maintenance request, and a tradesperson will contact you to find a time that suits.",
  rent: 'Thank you for your email about your rent.',
  lease_question: 'Thank you for your question.',
  complaint: "Thank you for letting us know about this, and we're sorry you've had to deal with it.",
  end_of_tenancy: 'Thank you for letting us know about your plans.',
  other: 'Thank you for your email.',
}

const SAFETY_ADVICE: Record<string, string> = {
  gas: "If you can smell gas, please leave the house, don't use light switches or anything that could spark, and call 111 from outside.",
  flooding: "If it's safe to, turn the water off at the toby and keep people and belongings away from the water.",
  electrical: "Please don't use the affected power point, and switch it off at the switchboard if it's safe to do so. If there is smoke or fire, leave the house and call 111.",
  water_electrics: "Please keep away from the wet light fitting or switch, and turn that circuit off at the switchboard if it's safe to do so.",
  fire: 'If there is smoke or fire, leave the house and call 111.',
  sewage: 'Please avoid using the toilet and drains until a plumber has checked them.',
  security: "If you haven't already, please report the break-in to the police.",
  no_heat_vulnerable: 'If you have a portable heater, please use it in the meantime and keep it well clear of bedding and curtains.',
  structural: 'Please keep everyone out of the affected room until it has been checked.',
  carbon_monoxide: 'Please get everyone outside into fresh air and call 111.',
}

export interface TemplateInput {
  category: Category
  firstName: string | null
  knownSender: boolean
  clauseNumber: number | null
  safety: SafetySignal[]
}

/** A short, safe reply that cites the matched clause. A person reviews it before anything is sent. */
export function templateReply(input: TemplateInput): string {
  const paragraphs: string[] = [input.firstName ? `Kia ora ${input.firstName},` : 'Kia ora,']

  if (input.safety.length > 0) {
    const advice = [...new Set(input.safety.map((s) => SAFETY_ADVICE[s.key]).filter(Boolean))]
    paragraphs.push(
      ['Thank you for letting us know. This sounds like an urgent repair, so a member of our team will call you as soon as possible.', ...advice].join(' '),
    )
  } else {
    paragraphs.push(OPENING[input.category])
  }

  if (!input.knownSender) {
    paragraphs.push('So that we can help, please reply with your full name and the address of the property you rent from us.')
  }

  const clause = input.clauseNumber !== null ? getClause(input.clauseNumber) : null
  if (clause) paragraphs.push(`The part of our tenancy terms that covers this is §${clause.number} ${clause.title} ${citation(clause.number)}.`)

  if (input.safety.length === 0) paragraphs.push('A member of our team will read your message and reply personally.')
  paragraphs.push('Ngā mihi,\nAcme Property Management')
  return paragraphs.join('\n\n')
}

/** The reply used when an email contains instructions aimed at an automated assistant. */
export function neutralReply(firstName: string | null, clauseNumber: number | null): string {
  const clause = clauseNumber !== null && clauseNumber !== 21 ? getClause(clauseNumber) : null
  const terms = [
    ...(clause ? [`The part of our tenancy terms that covers this is §${clause.number} ${clause.title} ${citation(clause.number)}.`] : []),
    `Changes to a tenancy are only agreed in writing by a member of our team ${citation(21)}.`,
  ].join(' ')
  return [
    firstName ? `Kia ora ${firstName},` : 'Kia ora,',
    'Thank you for your email. A member of our team will read it and reply personally.',
    terms,
    'Ngā mihi,\nAcme Property Management',
  ].join('\n\n')
}
