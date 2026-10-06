export type InboxCategory = 'maintenance' | 'rent' | 'lease_question' | 'complaint' | 'end_of_tenancy' | 'other'
export type InboxUrgency = 'urgent' | 'high' | 'normal' | 'low'
export type InboxStatus = 'new' | 'triaged' | 'approved' | 'sent' | 'dismissed'
export type InboxMethod = 'rules' | 'llm+rules'

export interface InboxFlag {
  type: string
  message: string
  /** True when this is a reason the message needs a person. */
  person: boolean
  detail?: string
}

export interface InboxTicketDecision {
  action: 'created' | 'linked' | 'none' | 'no_property'
  id: number | null
  title: string | null
  note: string
}

export interface InboxTriage {
  summary: string
  reasons: string[]
  flags: InboxFlag[]
  clauseCandidates: number[]
  citedClauses: number[]
  maintenance: { isIssue: boolean; title: string; description: string }
  ticket: InboxTicketDecision
  link: { method: 'sender' | 'signature' | 'address' | 'none'; note: string; knownSender: boolean; senderEmail: string; senderName: string | null; contractor: string | null }
  rules: { category: InboxCategory; urgency: InboxUrgency }
  model: { name: string; cached: boolean; category: InboxCategory; urgency: InboxUrgency; needsPerson: boolean } | null
  modelDraft: string | null
  removedSentences: { sentence: string; kinds: string[] }[]
  promiseHits: number
  systemDraft: string
  review?: { outcome: string; changed: boolean; at: string }
}

export interface InboxMessage {
  id: number
  externalId: string | null
  fromAddress: string
  subject: string
  body: string
  receivedAt: string
  category: InboxCategory | null
  urgency: InboxUrgency | null
  needsPerson: boolean
  reason: string | null
  replyDraft: string | null
  citedClause: string | null
  status: InboxStatus
  method: InboxMethod | null
  triage: InboxTriage | null
  approvedAt: string | null
  reviewSeconds: number | null
  createdAt: string
  tenant: { id: number; firstName: string; lastName: string; email: string } | null
  property: { id: number; code: string | null; address: string; suburb: string } | null
  maintenanceRequest: { id: number; title: string; priority: string; status: string; source: string; createdAt: string } | null
}

export interface InboxClause {
  number: number
  title: string
  text: string
}

export interface InboxMessageDetail extends InboxMessage {
  clauses: InboxClause[]
}

export interface InboxMeta {
  aiEnabled: boolean
  model: string | null
  webhookConfigured: boolean
  counts: { open: number; approved: number; dismissed: number; all: number }
}

export type InboxStatusFilter = 'open' | 'approved' | 'dismissed' | 'all'
