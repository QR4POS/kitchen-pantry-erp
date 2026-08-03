// ============================================================
// Database Type Definitions
// Matches the PostgreSQL schema in src/lib/db/schema.sql
// ============================================================

export type UserRole = 'admin' | 'staff' | 'contractor' | 'customer'
export type ProjectStatus =
  | 'inquiry' | 'site_visit' | 'measuring' | 'estimate_created'
  | 'quotation_sent' | 'approved' | 'production' | 'installation'
  | 'completed' | 'cancelled'
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent'
export type KitchenType = 'straight' | 'l_shape' | 'u_shape' | 'island' | 'parallel'
export type EstimateStatus = 'draft' | 'approved' | 'rejected'
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected'
export type CustomerPaymentType = 'advance' | 'progress' | 'final'
export type ContractorPaymentStatus = 'pending' | 'requested' | 'approved' | 'paid'
export type TransactionType = 'purchase' | 'used' | 'adjustment'

export interface ProfileRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  avatar_url: string | null
  role: UserRole
  is_active: boolean
  force_password_change: boolean
  created_at: string
  updated_at: string
}

export interface CustomerRow {
  id: string
  profile_id: string
  full_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ContractorRow {
  id: string
  profile_id: string
  company_name: string
  contact_person: string | null
  phone: string | null
  address: string | null
  bank_details: Record<string, unknown> | null
  skills: string[] | null
  total_completed_jobs: number
  total_earnings: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectRow {
  id: string
  customer_id: string
  contractor_id: string | null
  project_name: string
  description: string | null
  status: ProjectStatus
  priority: ProjectPriority
  start_date: string | null
  expected_completion: string | null
  completed_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMeasurementRow {
  id: string
  project_id: string
  kitchen_type: KitchenType
  length: number
  width: number
  height: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MaterialRow {
  id: string
  name: string
  category: string | null
  unit: string | null
  cost_price: number
  selling_price: number
  stock_quantity: number
  minimum_stock: number
  supplier_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMaterialRow {
  id: string
  project_id: string
  material_id: string
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

export interface EstimateRow {
  id: string
  project_id: string
  contractor_cost: number
  profit_amount: number
  customer_price: number
  profit_percentage: number
  status: EstimateStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EstimateItemRow {
  id: string
  estimate_id: string
  item_type: string
  item_name: string
  quantity: number
  cost_price: number
  selling_price: number
  created_at: string
}

export interface QuotationRow {
  id: string
  project_id: string
  estimate_id: string
  quotation_number: string
  pdf_url: string | null
  status: QuotationStatus
  sent_at: string | null
  created_by: string | null
  created_at: string
}

export interface CustomerPaymentRow {
  id: string
  project_id: string
  amount: number
  payment_type: CustomerPaymentType
  payment_method: string | null
  payment_date: string
  reference: string | null
  created_by: string | null
  created_at: string
}

export interface ContractorPaymentRow {
  id: string
  project_id: string
  contractor_id: string
  amount: number
  status: ContractorPaymentStatus
  paid_date: string | null
  created_by: string | null
  created_at: string
}

export interface InventoryTransactionRow {
  id: string
  material_id: string
  transaction_type: TransactionType
  quantity: number
  project_id: string | null
  created_by: string | null
  created_at: string
}

export interface ProjectFileRow {
  id: string
  project_id: string
  file_name: string
  file_url: string
  file_type: string | null
  uploaded_by: string | null
  created_at: string
}

export interface ConversationRow {
  id: string
  project_id: string
  created_at: string
}

export interface MessageRow {
  id: string
  conversation_id: string
  sender_id: string
  message: string | null
  file_url: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationRow {
  id: string
  user_id: string
  title: string
  message: string
  type: string | null
  is_read: boolean
  created_at: string
}

export interface AuditLogRow {
  id: string
  user_id: string | null
  action: string
  table_name: string
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

// ── AI WhatsApp Sales Agent ──

export type AiConversationStatus =
  | 'collecting_details'
  | 'processing'
  | 'reply_queued'
  | 'waiting_customer'
  | 'paused'
  | 'human_active'
  | 'qualified'
  | 'closed'
  | 'completed'
  | 'approved'
  | 'rejected'

export type ConversationAction = 'reply' | 'wait' | 'handoff' | 'close'
export type WhatsappDirection = 'incoming' | 'outgoing'
export type WhatsappMessageStatus = 'pending' | 'processing' | 'sent' | 'failed'
export type WhatsappMessageType = 'text' | 'image'
export type LeadStatus = 'new' | 'collecting' | 'waiting_approval' | 'approved' | 'rejected' | 'converted'

export interface AiAgentSettingsRow {
  id: string
  whatsapp_agent_enabled: boolean
  auto_reply_enabled: boolean
  auto_lead_creation: boolean
  auto_customer_creation: boolean
  auto_project_creation: boolean
  auto_notification_enabled: boolean
  admin_approval_required: boolean
  primary_provider: string
  fallback_provider: string
  welcome_message: string | null
  conversation_controller_enabled: boolean
  human_handoff_enabled: boolean
  created_at: string
  updated_at: string
}

export interface AiConversationRow {
  id: string
  phone_number: string
  customer_id: string | null
  conversation_status: AiConversationStatus
  current_step: string | null
  collected_data: Record<string, unknown> | null
  last_intent: string | null
  last_action: ConversationAction | null
  last_question: string | null
  last_inbound_message_id: string | null
  last_outbound_message_id: string | null
  ai_suppressed: boolean
  handoff_reason: string | null
  support_mode_at: string | null
  paused_until: string | null
  language_code: string | null
  turn_count: number
  misunderstanding_count: number
  created_at: string
  updated_at: string
}

export interface WhatsappMessageRow {
  id: string
  phone_number: string
  direction: WhatsappDirection
  message: string
  status: WhatsappMessageStatus
  ai_generated: boolean
  message_type: WhatsappMessageType
  media_url: string | null
  sent_at: string | null
  error_message: string | null
  dedup_key: string | null
  claimed_at: string | null
  retry_count: number
  provider_message_id: string | null
  source_inbound_message_id: string | null
  conversation_id: string | null
  decision_action: ConversationAction | null
  post_send_state: AiConversationStatus | null
  created_at: string
}

export interface AiAgentLogRow {
  id: string
  action: string
  provider: string | null
  status: string
  error_message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface LeadRow {
  id: string
  customer_id: string | null
  phone: string
  name: string | null
  email: string | null
  location: string | null
  kitchen_type: string | null
  kitchen_size: string | null
  budget: number | null
  material_preference: string | null
  status: LeadStatus
  source: string
  collected_data: Record<string, unknown> | null
  images: unknown[] | null
  conversation_id: string | null
  assigned_admin: string | null
  created_at: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: Partial<ProfileRow>; Update: Partial<ProfileRow> }
      customers: { Row: CustomerRow; Insert: Partial<CustomerRow>; Update: Partial<CustomerRow> }
      contractors: { Row: ContractorRow; Insert: Partial<ContractorRow>; Update: Partial<ContractorRow> }
      projects: { Row: ProjectRow; Insert: Partial<ProjectRow>; Update: Partial<ProjectRow> }
      project_measurements: { Row: ProjectMeasurementRow; Insert: Partial<ProjectMeasurementRow>; Update: Partial<ProjectMeasurementRow> }
      materials: { Row: MaterialRow; Insert: Partial<MaterialRow>; Update: Partial<MaterialRow> }
      project_materials: { Row: ProjectMaterialRow; Insert: Partial<ProjectMaterialRow>; Update: Partial<ProjectMaterialRow> }
      estimates: { Row: EstimateRow; Insert: Partial<EstimateRow>; Update: Partial<EstimateRow> }
      estimate_items: { Row: EstimateItemRow; Insert: Partial<EstimateItemRow>; Update: Partial<EstimateItemRow> }
      quotations: { Row: QuotationRow; Insert: Partial<QuotationRow>; Update: Partial<QuotationRow> }
      customer_payments: { Row: CustomerPaymentRow; Insert: Partial<CustomerPaymentRow>; Update: Partial<CustomerPaymentRow> }
      contractor_payments: { Row: ContractorPaymentRow; Insert: Partial<ContractorPaymentRow>; Update: Partial<ContractorPaymentRow> }
      inventory_transactions: { Row: InventoryTransactionRow; Insert: Partial<InventoryTransactionRow>; Update: Partial<InventoryTransactionRow> }
      project_files: { Row: ProjectFileRow; Insert: Partial<ProjectFileRow>; Update: Partial<ProjectFileRow> }
      conversations: { Row: ConversationRow; Insert: Partial<ConversationRow>; Update: Partial<ConversationRow> }
      messages: { Row: MessageRow; Insert: Partial<MessageRow>; Update: Partial<MessageRow> }
      notifications: { Row: NotificationRow; Insert: Partial<NotificationRow>; Update: Partial<NotificationRow> }
      audit_logs: { Row: AuditLogRow; Insert: Partial<AuditLogRow>; Update: Partial<AuditLogRow> }
      ai_agent_settings: { Row: AiAgentSettingsRow; Insert: Partial<AiAgentSettingsRow>; Update: Partial<AiAgentSettingsRow> }
      ai_conversations: { Row: AiConversationRow; Insert: Partial<AiConversationRow>; Update: Partial<AiConversationRow> }
      whatsapp_messages: { Row: WhatsappMessageRow; Insert: Partial<WhatsappMessageRow>; Update: Partial<WhatsappMessageRow> }
      ai_agent_logs: { Row: AiAgentLogRow; Insert: Partial<AiAgentLogRow>; Update: Partial<AiAgentLogRow> }
      leads: { Row: LeadRow; Insert: Partial<LeadRow>; Update: Partial<LeadRow> }
    }
    Functions: {
      get_user_role: { Args: never; Returns: UserRole }
      is_admin: { Args: never; Returns: boolean }
      is_contractor: { Args: never; Returns: boolean }
      is_customer: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      current_profile_id: { Args: never; Returns: string }
      current_contractor_id: { Args: never; Returns: string }
      current_customer_id: { Args: never; Returns: string }
    }
  }
}
