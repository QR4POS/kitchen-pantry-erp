export interface AccessoryItem {
  id: string
  name: string
  category: string
  contractorPrice: number
  customerPrice: number
  description: string
}

export const ACCESSORIES: AccessoryItem[] = [
  { id: 'hinge-standard', name: 'Standard Hinges (per set)', category: 'Hinges', contractorPrice: 250, customerPrice: 400, description: 'Standard 3D adjustable hinges' },
  { id: 'hinge-premium', name: 'Premium Soft-Close Hinges (per set)', category: 'Hinges', contractorPrice: 450, customerPrice: 750, description: 'Soft-close hydraulic hinges' },
  { id: 'drawer-standard', name: 'Standard Drawer Channels (per set)', category: 'Drawers', contractorPrice: 350, customerPrice: 550, description: 'Standard ball-bearing drawer channels' },
  { id: 'drawer-premium', name: 'Premium Soft-Close Drawers (per set)', category: 'Drawers', contractorPrice: 650, customerPrice: 1100, description: 'Full extension soft-close drawer channels' },
  { id: 'handle-standard', name: 'Standard Handles (per piece)', category: 'Handles', contractorPrice: 150, customerPrice: 250, description: 'Aluminum standard handles' },
  { id: 'handle-premium', name: 'Premium Designer Handles (per piece)', category: 'Handles', contractorPrice: 350, customerPrice: 600, description: 'Brass designer handles with finish' },
  { id: 'basket-standard', name: 'Standard Basket', category: 'Baskets', contractorPrice: 1200, customerPrice: 2000, description: 'Wire chrome basket' },
  { id: 'basket-premium', name: 'Premium Pull-Out Basket', category: 'Baskets', contractorPrice: 2500, customerPrice: 4000, description: 'Heavy-duty pull-out basket system' },
  { id: 'sink-standard', name: 'Standard Sink', category: 'Sinks', contractorPrice: 3000, customerPrice: 5000, description: 'Stainless steel single bowl sink' },
  { id: 'sink-premium', name: 'Premium Granite Sink', category: 'Sinks', contractorPrice: 8000, customerPrice: 14000, description: 'Granite composite sink with accessories' },
  { id: 'tap-standard', name: 'Standard Tap', category: 'Taps', contractorPrice: 1500, customerPrice: 2500, description: 'Chrome mixer tap' },
  { id: 'tap-premium', name: 'Premium Kitchen Mixer', category: 'Taps', contractorPrice: 4500, customerPrice: 7500, description: 'Premium swivel mixer with spray' },
  { id: 'lighting-under', name: 'Under Cabinet Lighting', category: 'Lighting', contractorPrice: 2000, customerPrice: 3500, description: 'LED strip lighting with driver' },
  { id: 'lighting-puck', name: 'Puck Lighting (per set)', category: 'Lighting', contractorPrice: 1500, customerPrice: 2500, description: 'LED puck lights set of 4' },
  { id: 'corner-unit', name: 'Corner Unit Solution', category: 'Storage', contractorPrice: 3500, customerPrice: 5500, description: 'Magic corner unit mechanism' },
  { id: 'tall-unit', name: 'Tall Unit Internal', category: 'Storage', contractorPrice: 4000, customerPrice: 6500, description: 'Tall unit pull-out storage system' },
]
