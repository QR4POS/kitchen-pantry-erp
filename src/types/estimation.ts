import { KitchenType, MaterialType } from './index';

export { KitchenType, MaterialType };

export type MeasureUnit = 'feet' | 'meters' | 'inches';

export interface Accessory {
  id: string;
  name: string;
  category: string;
  contractorPrice: number;
  customerPrice: number;
  quantity: number;
}

export interface MaterialPricing {
  material_type: MaterialType;
  base_cost_per_sqft: number;
  multiplier: number;
}

export interface KitchenDimensions {
  length: number;
  width: number;
  height: number;
  kitchen_type: KitchenType;
  wall_length?: number;
  num_cabinets?: number;
  num_drawers?: number;
  num_doors?: number;
  countertop_length?: number;
  island_length?: number;
  unit?: MeasureUnit;
  notes?: string;
}

export interface CabinetCalculation {
  type: 'base' | 'wall' | 'tall' | 'island';
  length: number;
  height: number;
  area: number;
  rate: number;
  total: number;
}

export interface AdditionalCost {
  id: string;
  name: string;
  amount: number;
  type: 'transportation' | 'installation' | 'electrical' | 'plumbing' | 'custom';
  isPercentage: boolean;
  percentageValue?: number;
}

export interface DiscountInfo {
  type: 'fixed' | 'percentage';
  value: number;
  description?: string;
}

export interface TaxInfo {
  name: string;
  rate: number;
  amount: number;
}

export interface EstimationBreakdownItem {
  category: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isContractorCost: boolean;
}

export interface EstimationResult {
  totalContractorCost: number;
  totalMaterialsCost: number;
  totalAccessoriesCost: number;
  laborCost: number;
  companyProfit: number;
  profitPercentage: number;
  customerPrice: number;
  additionalCosts: AdditionalCost[];
  discount: DiscountInfo | null;
  discountAmount: number;
  taxes: TaxInfo[];
  taxAmount: number;
  finalPrice: number;
  cabinetCalculations: CabinetCalculation[];
  breakdownItems: EstimationBreakdownItem[];
  areaCalculated: number;
}

export interface EstimateVersion {
  version: number;
  estimateId: string;
  contractorCost: number;
  profitAmount: number;
  profitPercentage: number;
  customerPrice: number;
  changedBy: string;
  changedAt: string;
  changeReason: string;
  data: Record<string, unknown>;
}

export interface EstimateItem {
  id?: string;
  estimate_id?: string;
  item_type: string;
  item_name: string;
  category?: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
}

export interface EstimateData {
  id: string;
  project_id: string;
  contractor_cost: number;
  profit_amount: number;
  profit_percentage: number;
  customer_price: number;
  discount_amount: number;
  tax_amount: number;
  final_price: number;
  status: 'draft' | 'review' | 'approved' | 'quotation_generated' | 'rejected';
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  items?: EstimateItem[];
}

export const LABOR_PERCENTAGE_DEFAULT = 0.25;
export const PROFIT_PERCENTAGE_DEFAULT = 0.30;

export const MaterialRates: MaterialPricing[] = [
  { material_type: MaterialType.MDF, base_cost_per_sqft: 45, multiplier: 1.0 },
  { material_type: MaterialType.Plywood, base_cost_per_sqft: 55, multiplier: 1.1 },
  { material_type: MaterialType.Melamine, base_cost_per_sqft: 40, multiplier: 0.9 },
  { material_type: MaterialType.Acrylic, base_cost_per_sqft: 70, multiplier: 1.3 },
  { material_type: MaterialType.HPL, base_cost_per_sqft: 60, multiplier: 1.2 },
  { material_type: MaterialType.PVC, base_cost_per_sqft: 35, multiplier: 0.8 },
];

export const AccessoryRates: { name: string; category: string; contractorPrice: number; customerPrice: number }[] = [
  { name: 'Handle - SS', category: 'Hardware', contractorPrice: 150, customerPrice: 250 },
  { name: 'Handle - Brass', category: 'Hardware', contractorPrice: 300, customerPrice: 500 },
  { name: 'Hinge - Hydraulic', category: 'Hinges', contractorPrice: 120, customerPrice: 200 },
  { name: 'Hinge - Standard', category: 'Hinges', contractorPrice: 60, customerPrice: 100 },
  { name: 'Drawer Slide - Soft Close', category: 'Drawers', contractorPrice: 450, customerPrice: 750 },
  { name: 'Drawer Slide - Standard', category: 'Drawers', contractorPrice: 250, customerPrice: 400 },
  { name: 'Tandem Box', category: 'Drawer System', contractorPrice: 850, customerPrice: 1400 },
  { name: 'Basket - Corner', category: 'Storage', contractorPrice: 2200, customerPrice: 3500 },
  { name: 'Basket - Cutlery', category: 'Storage', contractorPrice: 600, customerPrice: 1000 },
  { name: 'Tower Unit', category: 'Storage', contractorPrice: 4500, customerPrice: 7000 },
  { name: 'Pull Out - Bottle', category: 'Storage', contractorPrice: 3200, customerPrice: 5000 },
  { name: 'LED Strip Light', category: 'Lighting', contractorPrice: 500, customerPrice: 800 },
  { name: 'LED Spot Light', category: 'Lighting', contractorPrice: 350, customerPrice: 600 },
  { name: 'Chimney', category: 'Appliances', contractorPrice: 8500, customerPrice: 14000 },
  { name: 'Hob', category: 'Appliances', contractorPrice: 12000, customerPrice: 19000 },
  { name: 'Sink - SS Single', category: 'Plumbing', contractorPrice: 2500, customerPrice: 4000 },
  { name: 'Sink - SS Double', category: 'Plumbing', contractorPrice: 4000, customerPrice: 6500 },
  { name: 'Mixer - Kitchen', category: 'Plumbing', contractorPrice: 3500, customerPrice: 5500 },
  { name: 'Cooktop', category: 'Appliances', contractorPrice: 9500, customerPrice: 15000 },
  { name: 'OTG', category: 'Appliances', contractorPrice: 7500, customerPrice: 12000 },
];
