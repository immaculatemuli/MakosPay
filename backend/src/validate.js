import { z } from 'zod';
import { HttpError } from './errors.js';
import { normalizePhone } from './util.js';

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const phone = z.string().transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Kenyan phone number' });
    return z.NEVER;
  }
  return normalized;
});

/** Whole Kenyan shillings. */
export const kes = z.number().int().positive();
export const id = z.coerce.number().int().positive();
export const password = z.string().min(6).max(100);
export const name = z.string().trim().min(2).max(100);

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
});

export const dateRange = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
