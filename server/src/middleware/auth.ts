import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { type Actor, canDecide, isRole, type Role } from '../lib/actor'
import { prisma } from '../lib/prisma'

export interface AuthRequest extends Request {
  userId?: number
  /** The signed-in user, their organisation and role: every query is scoped to actor.organisationId. */
  actor?: Actor
}

/**
 * Checks the bearer token and loads the user's organisation and role from the database on every request, so a role
 * change or a removed account takes effect at once rather than when the token expires.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    res.status(401).json({ error: 'No token provided' })
    return
  }
  let userId: number
  try {
    userId = (jwt.verify(token, process.env.JWT_SECRET!) as { userId: number }).userId
  } catch {
    res.status(401).json({ error: 'Invalid token' })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organisationId: true, role: true } })
  if (!user) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }
  const role: Role = isRole(user.role) ? user.role : 'read_only'
  req.userId = user.id
  req.actor = { userId: user.id, organisationId: user.organisationId, role }
  next()
}

/** Blocks every change (anything but GET/HEAD/OPTIONS) for a read-only user. Mount it after authenticate. */
export function requireWrite(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  if (!req.actor || !canDecide(req.actor.role)) {
    res.status(403).json({ error: 'A read-only user can look but not change anything.' })
    return
  }
  next()
}

/** Allows only the given roles (for example managing users is a manager's job). */
export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      res.status(403).json({ error: `This needs one of these roles: ${roles.join(', ')}.` })
      return
    }
    next()
  }
}
