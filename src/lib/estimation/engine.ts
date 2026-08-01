import {
  KitchenType,
  MaterialType,
  type KitchenDimensions,
  type EstimationResult,
  type EstimationBreakdownItem,
  type CabinetCalculation,
  type AdditionalCost,
  type DiscountInfo,
  type TaxInfo,
  MaterialRates,
  LABOR_PERCENTAGE_DEFAULT,
  PROFIT_PERCENTAGE_DEFAULT,
} from '@/types/estimation'

const KITCHEN_TYPE_MULTIPLIER: Record<KitchenType, number> = {
  Straight: 1.0,
  LShape: 1.15,
  UShape: 1.3,
  Island: 1.25,
  Parallel: 1.1,
}

const KITCHEN_TYPE_CABINET_FACTOR: Record<KitchenType, { base: number; wall: number; tall: number }> = {
  Straight: { base: 1.0, wall: 0.8, tall: 0.2 },
  LShape: { base: 1.5, wall: 1.2, tall: 0.3 },
  UShape: { base: 2.0, wall: 1.6, tall: 0.4 },
  Island: { base: 1.2, wall: 0.6, tall: 0.2 },
  Parallel: { base: 1.6, wall: 1.2, tall: 0.3 },
}

function toFeet(value: number, unit: 'feet' | 'meters' | 'inches'): number {
  switch (unit) {
    case 'meters': return value * 3.28084;
    case 'inches': return value / 12;
    default: return value;
  }
}

export function calculateArea(dimensions: KitchenDimensions): number {
  const l = dimensions.length;
  const w = dimensions.width;
  const h = dimensions.height;

  switch (dimensions.kitchen_type) {
    case KitchenType.Straight:
      return l * h;
    case KitchenType.LShape:
      return (l + w - 2) * h;
    case KitchenType.UShape:
      return (l + 2 * w) * h;
    case KitchenType.Island:
      return l * h + (dimensions.island_length ?? 0) * 2;
    case KitchenType.Parallel:
      return 2 * l * h;
    default:
      return l * h;
  }
}

export function calculateCabinets(dimensions: KitchenDimensions): CabinetCalculation[] {
  const factor = KITCHEN_TYPE_CABINET_FACTOR[dimensions.kitchen_type];
  const baseRate = 3500;
  const wallRate = 2800;
  const tallRate = 4500;
  const islandRate = 4000;

  const baseLength = dimensions.length * factor.base;
  const wallLength = dimensions.length * factor.wall;
  const tallUnits = Math.ceil(dimensions.length / 6 * factor.tall);
  const islandLength = dimensions.island_length ?? 0;

  const cabinets: CabinetCalculation[] = [];

  if (baseLength > 0) {
    const height = 2.5;
    cabinets.push({
      type: 'base',
      length: baseLength,
      height,
      area: baseLength * height,
      rate: baseRate,
      total: baseLength * height * baseRate,
    });
  }

  if (wallLength > 0) {
    const height = 2.0;
    cabinets.push({
      type: 'wall',
      length: wallLength,
      height,
      area: wallLength * height,
      rate: wallRate,
      total: wallLength * height * wallRate,
    });
  }

  if (tallUnits > 0) {
    cabinets.push({
      type: 'tall',
      length: tallUnits,
      height: 7,
      area: tallUnits * 7,
      rate: tallRate,
      total: tallUnits * 7 * tallRate,
    });
  }

  if (islandLength > 0) {
    cabinets.push({
      type: 'island',
      length: islandLength,
      height: 3,
      area: islandLength * 3,
      rate: islandRate,
      total: islandLength * 3 * islandRate,
    });
  }

  return cabinets;
}

export interface EstimateInput {
  dimensions: KitchenDimensions;
  material: MaterialType;
  selectedAccessories?: { id: string; quantity: number; name: string; contractorPrice: number; customerPrice: number }[];
  additionalCosts?: AdditionalCost[];
  discount?: DiscountInfo | null;
  taxes?: { name: string; rate: number }[];
  laborPercentage?: number;
  profitPercentage?: number;
  laborFixed?: number;
  useFixedLabor?: boolean;
}

export function calculateEstimation(input: EstimateInput): EstimationResult {
  const { dimensions, material, selectedAccessories, additionalCosts, discount, taxes, laborPercentage, profitPercentage, laborFixed, useFixedLabor } = input;

  const area = calculateArea(dimensions);
  const multiplier = KITCHEN_TYPE_MULTIPLIER[dimensions.kitchen_type];
  const materialRate = MaterialRates.find(r => r.material_type === material);
  const materialCostPerSqft = materialRate ? materialRate.base_cost_per_sqft * materialRate.multiplier : 0;

  const materialCost = area * materialCostPerSqft * multiplier;
  const laborPct = laborPercentage ?? LABOR_PERCENTAGE_DEFAULT;
  const laborCost = useFixedLabor ? (laborFixed ?? 0) : materialCost * laborPct;

  // Cabinets
  const cabinetCalculations = calculateCabinets(dimensions);
  const cabinetCost = cabinetCalculations.reduce((sum, c) => sum + c.total, 0);

  // Accessories
  let accessoriesCost = 0;
  const accessoriesBreakdown: EstimationBreakdownItem[] = [];

  if (selectedAccessories && selectedAccessories.length > 0) {
    for (const acc of selectedAccessories) {
      const cost = acc.contractorPrice * acc.quantity;
      accessoriesCost += cost;
      accessoriesBreakdown.push({
        category: 'Accessories',
        description: acc.name,
        quantity: acc.quantity,
        unitPrice: acc.contractorPrice,
        totalPrice: cost,
        isContractorCost: true,
      });
    }
  }

  // Additional costs
  let additionalCostsTotal = 0;
  const additionalCostBreakdown: EstimationBreakdownItem[] = [];

  if (additionalCosts && additionalCosts.length > 0) {
    for (const ac of additionalCosts) {
      const amount = ac.isPercentage ? (materialCost * (ac.percentageValue ?? 0) / 100) : ac.amount;
      additionalCostsTotal += amount;
      additionalCostBreakdown.push({
        category: 'Additional',
        description: `${ac.name} (${ac.type})`,
        quantity: 1,
        unitPrice: amount,
        totalPrice: amount,
        isContractorCost: true,
      });
    }
  }

  // Total contractor cost
  const totalContractorCost = materialCost + laborCost + cabinetCost + accessoriesCost + additionalCostsTotal;

  // Profit
  const profitPct = profitPercentage ?? PROFIT_PERCENTAGE_DEFAULT;
  const companyProfit = totalContractorCost * profitPct;

  // Customer price before discount & tax
  const customerPrice = totalContractorCost + companyProfit;

  // Discount
  let discountAmount = 0;
  let discountInfo: DiscountInfo | null = discount ?? null;
  if (discount) {
    discountAmount = discount.type === 'fixed' ? discount.value : customerPrice * (discount.value / 100);
  }

  // Taxes
  let taxAmount = 0;
  const taxBreakdown: TaxInfo[] = [];
  if (taxes && taxes.length > 0) {
    const priceAfterDiscount = customerPrice - discountAmount;
    for (const t of taxes) {
      const taxAmt = priceAfterDiscount * (t.rate / 100);
      taxAmount += taxAmt;
      taxBreakdown.push({ name: t.name, rate: t.rate, amount: taxAmt });
    }
  }

  const finalPrice = customerPrice - discountAmount + taxAmount;

  // Breakdown items
  const breakdownItems: EstimationBreakdownItem[] = [
    {
      category: 'Materials',
      description: `${material} - ${dimensions.kitchen_type} Kitchen (${area.toFixed(1)} sq.ft)`,
      quantity: Math.round(area * 100) / 100,
      unitPrice: Math.round(materialCostPerSqft * multiplier),
      totalPrice: Math.round(materialCost),
      isContractorCost: true,
    },
    ...cabinetCalculations.map(c => ({
      category: 'Cabinets',
      description: `${c.type.charAt(0).toUpperCase() + c.type.slice(1)} Cabinet (${c.length.toFixed(1)}ft × ${c.height.toFixed(1)}ft)`,
      quantity: Math.round(c.area * 100) / 100,
      unitPrice: c.rate,
      totalPrice: Math.round(c.total),
      isContractorCost: true,
    })),
    {
      category: 'Labor',
      description: useFixedLabor ? 'Fixed Labor' : `Installation Labor (${(laborPct * 100).toFixed(0)}%)`,
      quantity: 1,
      unitPrice: Math.round(laborCost),
      totalPrice: Math.round(laborCost),
      isContractorCost: true,
    },
    ...accessoriesBreakdown,
    ...additionalCostBreakdown,
    {
      category: 'Profit',
      description: `Company Profit (${(profitPct * 100).toFixed(0)}%)`,
      quantity: 1,
      unitPrice: Math.round(companyProfit),
      totalPrice: Math.round(companyProfit),
      isContractorCost: false,
    },
  ];

  if (discountAmount > 0) {
    breakdownItems.push({
      category: 'Discount',
      description: discount?.type === 'fixed' ? `Fixed Discount` : `Discount (${discount?.value}%)`,
      quantity: 1,
      unitPrice: -Math.round(discountAmount),
      totalPrice: -Math.round(discountAmount),
      isContractorCost: false,
    });
  }

  if (taxAmount > 0) {
    for (const t of taxBreakdown) {
      breakdownItems.push({
        category: 'Tax',
        description: `${t.name} (${t.rate}%)`,
        quantity: 1,
        unitPrice: Math.round(t.amount),
        totalPrice: Math.round(t.amount),
        isContractorCost: false,
      });
    }
  }

  return {
    totalContractorCost: Math.round(totalContractorCost),
    totalMaterialsCost: Math.round(materialCost),
    totalAccessoriesCost: Math.round(accessoriesCost),
    laborCost: Math.round(laborCost),
    companyProfit: Math.round(companyProfit),
    profitPercentage: Math.round(profitPct * 100),
    customerPrice: Math.round(customerPrice),
    additionalCosts: additionalCosts ?? [],
    discount: discountInfo,
    discountAmount: Math.round(discountAmount),
    taxes: taxBreakdown,
    taxAmount: Math.round(taxAmount),
    finalPrice: Math.round(finalPrice),
    cabinetCalculations,
    breakdownItems,
    areaCalculated: Math.round(area * 100) / 100,
  }
}

export function recalculateWithProfit(contractorCost: number, profitPercentage: number): { profit: number; customerPrice: number } {
  const profit = contractorCost * (profitPercentage / 100);
  return {
    profit: Math.round(profit),
    customerPrice: Math.round(contractorCost + profit),
  };
}

export function recalculateWithCustomerPrice(contractorCost: number, customerPrice: number): { profit: number; profitPercentage: number } {
  const profit = customerPrice - contractorCost;
  return {
    profit,
    profitPercentage: contractorCost > 0 ? Math.round((profit / contractorCost) * 100) : 0,
  };
}

export function estimateToItems(result: EstimationResult): { item_type: string; item_name: string; quantity: number; cost_price: number; selling_price: number }[] {
  return result.breakdownItems.map(item => ({
    item_type: item.category,
    item_name: item.description,
    quantity: item.quantity,
    cost_price: item.isContractorCost ? item.totalPrice : 0,
    selling_price: item.isContractorCost ? 0 : item.totalPrice,
  }));
}

export function estimateToDbPayload(result: EstimationResult) {
  return {
    contractor_cost: result.totalContractorCost,
    profit_amount: result.companyProfit,
    profit_percentage: result.profitPercentage,
    customer_price: result.customerPrice,
    discount_amount: result.discountAmount,
    tax_amount: result.taxAmount,
    final_price: result.finalPrice,
    status: 'draft',
  };
}
