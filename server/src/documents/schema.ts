// Field schemas: zod for checking values (from the model, or from a person's corrections), and the JSON schema the
// model is asked to fill, with a value and a confidence for every field.
import { z } from 'zod'
import { parseMoney } from './parse'
import type { DocumentKind } from './types'

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
  }, 'is not a real calendar date')

/** Dollars with at most two decimals; "1,420.00" is accepted and read as 1420. */
const money = z.preprocess(
  (v) => (typeof v === 'string' ? parseMoney(v) : v),
  z
    .number()
    .finite()
    .nonnegative('cannot be negative')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'has more than two decimals'),
)

const lineItem = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().nullable(),
  unitAmount: z.number().nullable(),
  amount: money,
})

export const INVOICE_VALUE_SCHEMAS: Record<string, z.ZodType> = {
  supplierName: z.string().trim().min(2).nullable(),
  supplierGstNumber: z
    .string()
    .regex(/^\d{2,3}[-\s]?\d{3}[-\s]?\d{3}$/, 'must look like 123-456-789')
    .nullable(),
  supplierBankAccount: z
    .string()
    .regex(/^\d{2}[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d{2,3}$/, 'must look like 12-3456-7890123-00')
    .nullable(),
  invoiceNumber: z.string().trim().min(1).nullable(),
  invoiceDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  propertyAddress: z.string().trim().min(5).nullable(),
  lineItems: z.array(lineItem).nullable(),
  subtotal: money.nullable(),
  gst: money.nullable(),
  total: money.nullable(),
}

export const LEASE_VALUE_SCHEMAS: Record<string, z.ZodType> = {
  tenantNames: z.array(z.string().trim().min(2)).min(1).nullable(),
  propertyAddress: z.string().trim().min(5).nullable(),
  startDate: isoDate.nullable(),
  endDate: z.union([z.literal('periodic'), isoDate]).nullable(),
  weeklyRent: money.nullable(),
  bond: money.nullable(),
  rentFrequency: z.enum(['weekly', 'fortnightly', 'monthly']).nullable(),
  petsAllowed: z.boolean().nullable(),
  maxOccupants: z.number().int().positive().nullable(),
}

export const valueSchemas = (kind: DocumentKind) => (kind === 'invoice' ? INVOICE_VALUE_SCHEMAS : LEASE_VALUE_SCHEMAS)

export const confidenceSchema = z.enum(['high', 'medium', 'low'])

// ---------------------------------------------------------------------------------------------------------------
// JSON schema for structured output

type Json = Record<string, unknown>
const nullable = (type: string, extra: Json = {}): Json => ({ type: [type, 'null'], ...extra })
const field = (value: Json): Json => ({
  type: 'object',
  properties: { value, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['value', 'confidence'],
})
const object = (properties: Record<string, Json>): Json => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
})

const INVOICE_JSON_SCHEMA = object({
  supplierName: field(nullable('string')),
  supplierGstNumber: field(nullable('string')),
  supplierBankAccount: field(nullable('string')),
  invoiceNumber: field(nullable('string')),
  invoiceDate: field(nullable('string', { description: 'YYYY-MM-DD' })),
  dueDate: field(nullable('string', { description: 'YYYY-MM-DD' })),
  propertyAddress: field(nullable('string')),
  lineItems: field(
    nullable('array', {
      items: object({
        description: { type: 'string' },
        quantity: nullable('number'),
        unitAmount: nullable('number'),
        amount: { type: 'number' },
      }),
    }),
  ),
  subtotal: field(nullable('number')),
  gst: field(nullable('number')),
  total: field(nullable('number')),
})

const LEASE_JSON_SCHEMA = object({
  tenantNames: field(nullable('array', { items: { type: 'string' } })),
  propertyAddress: field(nullable('string')),
  startDate: field(nullable('string', { description: 'YYYY-MM-DD' })),
  endDate: field(nullable('string', { description: 'YYYY-MM-DD, or "periodic"' })),
  weeklyRent: field(nullable('number')),
  bond: field(nullable('number')),
  rentFrequency: field(nullable('string', { enum: ['weekly', 'fortnightly', 'monthly', null] })),
  petsAllowed: field(nullable('boolean')),
  maxOccupants: field(nullable('integer')),
})

export const jsonSchema = (kind: DocumentKind) =>
  kind === 'invoice'
    ? { name: 'invoice_fields', schema: INVOICE_JSON_SCHEMA }
    : { name: 'tenancy_summary_fields', schema: LEASE_JSON_SCHEMA }
