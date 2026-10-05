import { prisma } from '../lib/prisma'

/** What is waiting for a person right now, across every automation. */
export async function workQueue(userId: number) {
  const open = { in: ['new', 'triaged'] }
  const [documentsToReview, inboxNeedsPerson, urgentInbox, bankExceptions, overdueRent] = await Promise.all([
    prisma.document.count({ where: { userId, status: 'needs_review' } }),
    prisma.inboxMessage.count({ where: { userId, status: open, needsPerson: true } }),
    prisma.inboxMessage.count({ where: { userId, status: open, urgency: 'urgent' } }),
    prisma.bankTransaction.count({ where: { userId, matchStatus: 'exception' } }),
    prisma.payment.count({ where: { status: 'overdue', lease: { property: { userId } } } }),
  ])
  return { documentsToReview, inboxNeedsPerson, urgentInbox, bankExceptions, overdueRent }
}
