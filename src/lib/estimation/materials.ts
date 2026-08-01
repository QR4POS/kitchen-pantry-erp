export interface MaterialRate {
  material: string
  name: string
  baseCostPerSqft: number
  description: string
}

export const MATERIAL_RATES: MaterialRate[] = [
  { material: 'MDF', name: 'MDF (Medium Density Fiberboard)', baseCostPerSqft: 450, description: 'Standard MDF with moisture resistant coating' },
  { material: 'Plywood', name: 'Plywood', baseCostPerSqft: 550, description: 'Marine-grade plywood with premium finish' },
  { material: 'Melamine', name: 'Melamine', baseCostPerSqft: 350, description: 'Melamine faced chipboard - economical option' },
  { material: 'Acrylic', name: 'Acrylic', baseCostPerSqft: 750, description: 'High-gloss acrylic finish - premium look' },
  { material: 'HPL', name: 'HPL (High Pressure Laminate)', baseCostPerSqft: 650, description: 'Durable HPL with scratch resistant surface' },
  { material: 'PVC', name: 'PVC', baseCostPerSqft: 400, description: 'PVC foam board - waterproof option' },
]
