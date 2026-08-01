import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  full_name: z.string().min(1, 'Full name is required'),
  role: z.enum(['ADMIN', 'CONTRACTOR', 'STAFF', 'CUSTOMER']),
});

export const customerSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(1, 'Phone is required'),
  company: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const contractorSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  phone: z.string().min(1, 'Phone is required'),
  email: z.string().email('Invalid email address'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  specialization: z.string().optional(),
  experience_years: z.number().int().nonnegative().optional(),
});

export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  kitchen_type: z.enum(['Straight', 'LShape', 'UShape', 'Island', 'Parallel']),
  length: z.number().positive('Length must be positive'),
  width: z.number().positive('Width must be positive'),
  height: z.number().positive('Height must be positive'),
  material_type: z.enum(['MDF', 'Plywood', 'Melamine', 'Acrylic', 'HPL', 'PVC']),
  customer_id: z.string().min(1, 'Customer is required'),
  contractor_id: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
});

export const estimateSchema = z.object({
  project_id: z.string().min(1, 'Project is required'),
  contractor_cost: z.number().nonnegative('Contractor cost must be non-negative'),
  profit_amount: z.number().nonnegative('Profit must be non-negative').optional(),
  profit_percentage: z.number().min(0).max(100).optional(),
  customer_price: z.number().nonnegative('Customer price must be non-negative'),
  discount_amount: z.number().nonnegative().optional().default(0),
  tax_amount: z.number().nonnegative().optional().default(0),
  final_price: z.number().nonnegative().optional(),
  status: z.enum(['draft', 'review', 'approved', 'quotation_generated', 'rejected']).optional().default('draft'),
  version: z.number().int().positive().optional().default(1),
});

export const estimateItemSchema = z.object({
  estimate_id: z.string().optional(),
  item_type: z.string().min(1, 'Item type is required'),
  item_name: z.string().min(1, 'Item name is required'),
  category: z.string().optional(),
  quantity: z.number().positive('Quantity must be positive'),
  cost_price: z.number().nonnegative(),
  selling_price: z.number().nonnegative(),
});

export const estimateVersionSchema = z.object({
  estimate_id: z.string().min(1, 'Estimate ID is required'),
  contractor_cost: z.number().nonnegative(),
  profit_amount: z.number().nonnegative(),
  profit_percentage: z.number().min(0).max(100),
  customer_price: z.number().nonnegative(),
  change_reason: z.string().min(1, 'Change reason is required'),
});

export const additionalCostSchema = z.object({
  name: z.string().min(1, 'Cost name is required'),
  amount: z.number().nonnegative(),
  type: z.enum(['transportation', 'installation', 'electrical', 'plumbing', 'custom']),
  isPercentage: z.boolean().default(false),
  percentageValue: z.number().min(0).max(100).optional(),
});

export const discountSchema = z.object({
  type: z.enum(['fixed', 'percentage']),
  value: z.number().min(0, 'Discount must be non-negative'),
  description: z.string().optional(),
});

export const paymentSchema = z.object({
  project_id: z.string().min(1, 'Project is required'),
  amount: z.number().positive('Amount must be positive'),
  payment_type: z.enum(['CUSTOMER_PAYMENT', 'CONTRACTOR_PAYMENT']),
  payment_method: z.string().min(1, 'Payment method is required'),
  due_date: z.string().min(1, 'Due date is required'),
});

export const quotationSchema = z.object({
  project_id: z.string().min(1, 'Project is required'),
  customer_price: z.number().nonnegative(),
  terms: z.string().optional(),
  warranty_years: z.number().int().nonnegative().optional(),
  valid_until: z.string().min(1, 'Valid until date is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type ContractorInput = z.infer<typeof contractorSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type EstimateInput = z.infer<typeof estimateSchema>;
export type EstimateItemInput = z.infer<typeof estimateItemSchema>;
export type EstimateVersionInput = z.infer<typeof estimateVersionSchema>;
export type AdditionalCostInput = z.infer<typeof additionalCostSchema>;
export type DiscountInput = z.infer<typeof discountSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type QuotationInput = z.infer<typeof quotationSchema>;
