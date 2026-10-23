import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { isRole, limitsForClient, ROLE_LABELS, ROLES, type Role } from '../lib/actor'
import { audit } from '../lib/audit'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, type AuthRequest } from '../middleware/auth'

const router = Router()

type UserRow = { id: number; email: string; name: string; role: string; organisationId: number; organisation: { id: number; name: string; slug: string; country: string; currency: string } }
const USER_SELECT = { id: true, email: true, name: true, role: true, organisationId: true, organisation: { select: { id: true, name: true, slug: true, country: true, currency: true } } } as const

/** What the client keeps about the signed-in user: who, which company, which role and what the role may approve. */
export function publicUser(user: UserRow) {
  const role: Role = isRole(user.role) ? user.role : 'read_only'
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    roleLabel: ROLE_LABELS[role],
    limits: limitsForClient(role),
    organisation: user.organisation,
  }
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company'

/** Registers a new company with its first user as the manager. */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body
    const companyName = typeof req.body.company === 'string' && req.body.company.trim() ? req.body.company.trim().slice(0, 80) : `${name}'s company`
    if (!email || !password || !name) {
      res.status(400).json({ error: 'All fields are required' })
      return
    }
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      res.status(400).json({ error: 'Email already registered' })
      return
    }
    const hashed = await bcrypt.hash(password, 10)
    const base = slugify(companyName)
    let slug = base
    for (let n = 2; await prisma.organisation.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`
    const user = await prisma.user.create({
      data: { email, password: hashed, name, role: 'manager', organisation: { create: { name: companyName, slug } } },
      select: USER_SELECT,
    })
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
    res.status(201).json({ token, user: publicUser(user) })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email }, select: { ...USER_SELECT, password: true } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
    res.json({ token, user: publicUser(user) })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

/** The signed-in user, re-read from the database (the role may have changed since sign-in). */
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.actor!.userId }, select: USER_SELECT })
  if (!user) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }
  res.json(publicUser(user))
})

/** The company's users and roles. Anyone in the company can see who is who; only a manager changes roles. */
router.get('/users', authenticate, async (req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    where: { organisationId: req.actor!.organisationId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { id: 'asc' },
  })
  res.json({ roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], limits: limitsForClient(r) })), users })
})

router.put('/users/:id/role', authenticate, requireRole('manager'), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id)
  const role = req.body?.role
  if (!isRole(role)) {
    res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` })
    return
  }
  const user = await prisma.user.findFirst({ where: { id, organisationId: req.actor!.organisationId } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (user.id === req.actor!.userId && role !== 'manager') {
    res.status(400).json({ error: 'You cannot remove your own manager role.' })
    return
  }
  const updated = await prisma.user.update({ where: { id }, data: { role }, select: { id: true, email: true, name: true, role: true } })
  await audit({ actor: req.actor!, action: 'user.role_changed', entity: 'user', entityId: id, field: 'role', before: user.role, after: role, note: `${user.name}: ${ROLE_LABELS[user.role as Role] ?? user.role} to ${ROLE_LABELS[role]}.` })
  res.json(updated)
})

export default router
