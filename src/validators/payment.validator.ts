import { z } from 'zod';
import { PAYMENT_METHODS } from '../constants/payments.js';

const paymentMethodValues = PAYMENT_METHODS.map((method) => method.code) as [
  string,
  ...string[],
];

export const CreatePaymentOrderSchema = z.object({
  package_code: z.string().trim().min(1).max(40),
  payment_method: z.enum(paymentMethodValues),
});

export const ListPaymentOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
