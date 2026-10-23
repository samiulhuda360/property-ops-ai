// Who is acting, for which company, with which role. Every service takes an Actor: reads are scoped to the
// organisation, writes record the user, and the role decides what the person may approve.

export const ROLES = ['manager', 'accounts', 'property_manager', 'read_only'] as const
export type Role = (typeof ROLES)[number]

export interface Actor {
  userId: number
  organisationId: number
  role: Role
}

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Manager',
  accounts: 'Accounts',
  property_manager: 'Property manager',
  read_only: 'Read only',
}

/**
 * What each role may approve, in the organisation's currency. A document (supplier invoice) or a work order above
 * the role's limit needs a manager. Zero means the role can look but never approve.
 */
export const APPROVAL_LIMITS: Record<Role, { invoice: number; workOrder: number; canDecide: boolean }> = {
  manager: { invoice: Infinity, workOrder: Infinity, canDecide: true },
  accounts: { invoice: 5000, workOrder: 1000, canDecide: true },
  property_manager: { invoice: 1000, workOrder: 2500, canDecide: true },
  read_only: { invoice: 0, workOrder: 0, canDecide: false },
}

/** An Actor from a User row (the demo loaders and scripts). */
export const actorFor = (user: { id: number; organisationId: number; role: string }): Actor => ({
  userId: user.id,
  organisationId: user.organisationId,
  role: isRole(user.role) ? user.role : 'read_only',
})

export const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value)

export class PermissionError extends Error {
  readonly status = 403
}

/** True when the role may make decisions at all (approve, correct, dismiss, resolve). */
export const canDecide = (role: Role): boolean => APPROVAL_LIMITS[role].canDecide

/**
 * Checks an approval against the role's limit. `amount` is the money at stake (an invoice total, a work order's
 * budget ceiling); null means no money is involved and only the right to decide matters.
 */
export function assertCanApprove(actor: Actor, kind: 'invoice' | 'workOrder', amount: number | null): void {
  const limits = APPROVAL_LIMITS[actor.role]
  if (!limits.canDecide) throw new PermissionError(`A ${ROLE_LABELS[actor.role].toLowerCase()} user can look but not approve.`)
  if (amount !== null && amount > limits[kind]) {
    const what = kind === 'invoice' ? 'invoices' : 'work orders'
    throw new PermissionError(
      `${ROLE_LABELS[actor.role]} can approve ${what} up to ${limits[kind].toLocaleString('en-NZ')}; this one is ${amount.toLocaleString('en-NZ')} and needs a manager.`,
    )
  }
}

/** The limits as plain numbers for the client (Infinity has no JSON form). */
export function limitsForClient(role: Role) {
  const l = APPROVAL_LIMITS[role]
  return { invoice: Number.isFinite(l.invoice) ? l.invoice : null, workOrder: Number.isFinite(l.workOrder) ? l.workOrder : null, canDecide: l.canDecide }
}
