import { prisma } from '../lib/prisma'

/** What is waiting for a person right now, across every automation. */
export async function workQueue(organisationId: number) {
  const open = { in: ['new', 'triaged'] }
  const [documentsToReview, inboxNeedsPerson, urgentInbox, bankExceptions, overdueRent] = await Promise.all([
    prisma.document.count({ where: { organisationId, status: 'needs_review' } }),
    prisma.inboxMessage.count({ where: { organisationId, status: open, needsPerson: true } }),
    prisma.inboxMessage.count({ where: { organisationId, status: open, urgency: 'urgent' } }),
    prisma.bankTransaction.count({ where: { organisationId, matchStatus: 'exception' } }),
    prisma.payment.count({ where: { status: 'overdue', lease: { property: { organisationId } } } }),
  ])
  return { documentsToReview, inboxNeedsPerson, urgentInbox, bankExceptions, overdueRent }
}
