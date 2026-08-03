export interface CreateCustomerInput {
  fullName: string
  email: string
  phone: string
  address?: string
  city?: string
  notes?: string
  createdBy: string
}

export interface CreateCustomerResult {
  success: boolean
  error?: string
  customerId?: string
  email?: string
  temporaryPassword?: string
  whatsappSent?: boolean
}

export interface TemporaryPasswordPayload {
  hash: string
  password: string
  createdAt: string
}
