import { PrismaClient } from '@prisma/client'

// One client for the whole server (each PrismaClient holds its own connection pool).
export const prisma = new PrismaClient()
