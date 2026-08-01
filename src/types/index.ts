export enum Role {
  ADMIN = 'ADMIN',
  CONTRACTOR = 'CONTRACTOR',
  STAFF = 'STAFF',
  CUSTOMER = 'CUSTOMER',
}

export enum KitchenType {
  Straight = 'Straight',
  LShape = 'LShape',
  UShape = 'UShape',
  Island = 'Island',
  Parallel = 'Parallel',
}

export enum MaterialType {
  MDF = 'MDF',
  Plywood = 'Plywood',
  Melamine = 'Melamine',
  Acrylic = 'Acrylic',
  HPL = 'HPL',
  PVC = 'PVC',
}

export enum ProjectStatus {
  NewLead = 'NewLead',
  SiteVisit = 'SiteVisit',
  Measuring = 'Measuring',
  EstimateCreated = 'EstimateCreated',
  QuotationSent = 'QuotationSent',
  Approved = 'Approved',
  Production = 'Production',
  Installation = 'Installation',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  avatar_url?: string;
  phone?: string;
  is_active?: boolean;
  force_password_change?: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  profile_id?: string;
  full_name?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
}

export interface Contractor {
  id: string;
  user_id: string;
  company_name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  specialization?: string;
  experience_years?: number;
  payment_terms?: string;
  is_active: boolean;
  created_at: string;
}

export interface Staff {
  id: string;
  user_id: string;
  designation?: string;
  department?: string;
  phone?: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  customer_id: string;
  contractor_id?: string;
  staff_id?: string;
  kitchen_type: KitchenType;
  length: number;
  width: number;
  height: number;
  material_type: MaterialType;
  status: ProjectStatus;
  estimated_cost?: number;
  contractor_cost?: number;
  customer_price?: number;
  profit_margin?: number;
  start_date?: string;
  expected_end_date?: string;
  completed_date?: string;
  address?: string;
  city?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Estimate {
  id: string;
  project_id: string;
  contractor_cost: number;
  profit_amount: number;
  profit_percentage: number;
  customer_price: number;
  discount_amount?: number;
  tax_amount?: number;
  final_price?: number;
  status: 'draft' | 'review' | 'approved' | 'quotation_generated' | 'rejected';
  version?: number;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  projects?: { name: string; project_name?: string } | null;
  // Legacy field aliases for backward compatibility
  company_profit?: number;
  materials_cost?: number;
  accessories_cost?: number;
  labor_cost?: number;
  total_cost?: number;
  profit_margin_percentage?: number;
}

export interface Quotation {
  id: string;
  project_id: string;
  customer_id: string;
  estimate_id: string;
  quotation_number: string;
  version_number?: number;
  title?: string;
  description?: string;
  customer_message?: string;
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  customer_price: number;
  final_amount?: number;
  terms?: string;
  warranty_years?: number;
  valid_until?: string;
  status: 'draft' | 'generated' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  pdf_url?: string;
  sent_at?: string;
  viewed_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  projects?: { name: string; project_name?: string } | null;
  customers?: { full_name: string; company?: string } | null;
}

export enum PaymentType {
  CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT',
  CONTRACTOR_PAYMENT = 'CONTRACTOR_PAYMENT',
}

export interface Payment {
  id: string;
  project_id: string;
  customer_id?: string;
  contractor_id?: string;
  amount: number;
  payment_type: PaymentType;
  payment_method?: string;
  status?: string;
  due_date?: string;
  paid_date?: string;
  description?: string;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category?: string;
  material_type?: MaterialType;
  quantity: number;
  unit_price: number;
  supplier?: string;
  min_stock_level?: number;
  current_stock: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  project_id?: string;
  content: string;
  attachment_url?: string;
  is_read: boolean;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type?: string;
  is_read: boolean;
  created_at: string;
}

export interface Supplier {
  id: string;
  company_name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  tax_number?: string;
  payment_terms?: string;
  notes?: string;
  status?: 'active' | 'inactive';
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  purchase_number?: string;
  status: 'draft' | 'sent' | 'approved' | 'received' | 'cancelled';
  subtotal?: number;
  tax_amount?: number;
  total_amount?: number;
  expected_delivery?: string;
  created_by?: string;
  created_at: string;
  suppliers?: Supplier | null;
  purchase_order_items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  material_id: string;
  quantity: number;
  unit_price: number;
  total_price?: number;
  materials?: { name: string } | null;
}

export interface DashboardStats {
  total_customers: number;
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  pending_quotations: number;
  monthly_revenue: number;
  monthly_profit: number;
  pending_payments: number;
  contractor_payments: number;
}
