import type { CreateCustomerInput } from './types'

export interface ValidationError {
  field: string
  message: string
}

export function validateCustomerInput(input: CreateCustomerInput): ValidationError[] {
  const errors: ValidationError[] = []

  if (!input.fullName || input.fullName.trim().length < 2) {
    errors.push({ field: 'fullName', message: 'Full name is required (minimum 2 characters)' })
  }

  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.push({ field: 'email', message: 'Valid email address is required' })
  }

  if (!input.phone || input.phone.replace(/\D/g, '').length < 7) {
    errors.push({ field: 'phone', message: 'Valid phone number is required' })
  }

  if (!input.createdBy) {
    errors.push({ field: 'createdBy', message: 'Admin user ID is required' })
  }

  return errors
}
