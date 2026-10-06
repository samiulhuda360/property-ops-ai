// Shared types for the tenant inbox triage.

export const CATEGORIES = ['maintenance', 'rent', 'lease_question', 'complaint', 'end_of_tenancy', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export const URGENCIES = ['urgent', 'high', 'normal', 'low'] as const
export type Urgency = (typeof URGENCIES)[number]

const URGENCY_RANK: Record<Urgency, number> = { low: 0, normal: 1, high: 2, urgent: 3 }

/** The more urgent of two levels: rules may raise the model's urgency but never lower it. */
export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b
}

/** Maintenance job priority for each urgency. */
export const TICKET_PRIORITY: Record<Urgency, 'urgent' | 'high' | 'medium' | 'low'> = {
  urgent: 'urgent',
  high: 'high',
  normal: 'medium',
  low: 'low',
}

/** rules: keyword rules and a template reply. llm: the model's raw output (evaluation only). llm+rules: the shipped pipeline. */
export type TriageMethod = 'rules' | 'llm' | 'llm+rules'

export interface EmailInput {
  from: string
  subject: string
  text: string
  receivedAt: Date
}

export type FlagType =
  | 'urgent_safety'
  | 'injection'
  | 'unknown_sender'
  | 'unverified_sender'
  | 'contractor'
  | 'not_linked'
  | 'promise'
  | 'citation'
  | 'model'
  | 'model_error'
  | 'rules_only'
  | 'ticket'

/** Something the reviewer should know. `person: true` means it is a reason the message needs a person. */
export interface TriageFlag {
  type: FlagType
  message: string
  person: boolean
  detail?: string
}

export type PromiseKind = 'date' | 'payment' | 'rent_change' | 'approval'

export const PROMISE_LABEL: Record<PromiseKind, string> = {
  date: 'a date or time',
  payment: 'a payment or refund',
  rent_change: 'a rent change',
  approval: 'an approval',
}
