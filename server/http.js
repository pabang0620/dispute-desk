import { z } from 'zod'

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return result.data
}

export const disputeIdSchema = z.string().regex(/^PP-R-[A-Z]{3}-\d{5,12}$/, 'Not a PayPal dispute id')
