export type BudgetTier = 'economy' | 'standard' | 'premium' | 'luxury'

export interface MaterialKnowledge {
  id: string
  name: string
  shortName: string
  category: 'board' | 'laminate' | 'acrylic' | 'pvc'
  pricePerSqft: number
  minBudgetTier: BudgetTier
  description: string
  pros: string[]
  cons: string[]
  bestFor: string[]
  durability: number
  waterResistance: number
  finishQuality: number
  maintenance: string
  warranty: string
  lifespan: string
  keyDifferentiator: string
}

export interface BudgetTierInfo {
  tier: BudgetTier
  minBudget: number
  maxBudget: number
  label: string
  recommendedMaterials: string[]
  description: string
}

export interface AccessoryKnowledge {
  id: string
  name: string
  category: string
  minPrice: number
  maxPrice: number
  description: string
  recommendedFor: BudgetTier[]
  notes: string
}

export interface FAQEntry {
  id: string
  question: string
  answer: string
  category: 'materials' | 'pricing' | 'installation' | 'warranty' | 'delivery' | 'payment' | 'design' | 'maintenance' | 'general'
  keywords: string[]
}

export interface CompanyKnowledge {
  name: string
  tagline: string
  services: string[]
  warrantyTerms: string
  installationTimeStandard: string
  installationTimeComplex: string
  deliveryInfo: string
  paymentTerms: string
  paymentMethods: string
  serviceAreas: string[]
  siteVisitInfo: string
  designProcess: string
  afterSalesSupport: string
  certifications: string[]
  experience: string
}

export const MATERIALS: MaterialKnowledge[] = [
  {
    id: 'melamine',
    name: 'Melamine (Melamine-Faced Chipboard)',
    shortName: 'Melamine',
    category: 'board',
    pricePerSqft: 350,
    minBudgetTier: 'economy',
    description: 'Economical particleboard surfaced with decorative melamine paper. Available in a wide range of colours and woodgrain finishes. A practical choice for budget-conscious kitchen renovations.',
    pros: [
      'Most affordable kitchen material on the market',
      'Wide variety of colours and woodgrain patterns',
      'Easy to clean with a damp cloth',
      'Pre-finished — no painting or polishing required',
      'Lightweight and fast to install',
    ],
    cons: [
      'Less moisture-resistant than plywood or PVC',
      'Cannot be reshaped or repaired once damaged',
      'Edges can chip if exposed to heavy impact',
      'Not ideal for areas with direct water contact',
      'Shorter lifespan compared to premium materials',
    ],
    bestFor: ['Rental properties', 'Budget kitchens', 'Dry pantry areas', 'Low-moisture environments'],
    durability: 2,
    waterResistance: 2,
    finishQuality: 3,
    maintenance: 'Wipe with a damp cloth. Avoid prolonged water exposure on edges. Do not use abrasive cleaners.',
    warranty: '1-year warranty against manufacturing defects',
    lifespan: '5-8 years with proper care',
    keyDifferentiator: 'Best value for money — lowest cost per square foot with acceptable quality for budget projects',
  },
  {
    id: 'mdf',
    name: 'MDF (Medium Density Fiberboard)',
    shortName: 'MDF',
    category: 'board',
    pricePerSqft: 450,
    minBudgetTier: 'standard',
    description: 'Engineered wood product made from compressed wood fibres with resin. Smooth surface ideal for painting or laminate finishing. Popular for Shaker-style and painted kitchen doors.',
    pros: [
      'Smooth, uniform surface — excellent for painted finishes',
      'No grain or knots — consistent appearance',
      'Good dimensional stability — does not warp easily',
      'More affordable than solid wood or plywood',
      'Available with moisture-resistant (MR) treatment',
    ],
    cons: [
      'Heavier than melamine and plywood',
      'Standard MDF swells if exposed to water',
      'Cannot hold screws as well as plywood',
      'Dust-intensive during cutting and installation',
      'MR-grade costs more than standard',
    ],
    bestFor: ['Painted Shaker-style kitchens', 'Indoor cabinets', 'Moderate budgets', 'Dry kitchen environments'],
    durability: 3,
    waterResistance: 2,
    finishQuality: 4,
    maintenance: 'Clean with mild detergent. Keep dry. Touch up paint chips promptly. Use moisture-resistant grade for kitchen use.',
    warranty: '3-year warranty on moisture-resistant MDF',
    lifespan: '8-12 years with moisture-resistant grade',
    keyDifferentiator: 'Best painted finish quality in its price range — ideal for custom-colour kitchen doors',
  },
  {
    id: 'pvc',
    name: 'PVC (Polyvinyl Chloride Foam Board)',
    shortName: 'PVC',
    category: 'pvc',
    pricePerSqft: 400,
    minBudgetTier: 'economy',
    description: '100% waterproof synthetic board made from PVC foam. Completely impervious to water, termites, and moisture. Excellent choice for wet areas, outdoor kitchens, and coastal locations.',
    pros: [
      '100% waterproof — ideal for wet areas and coastal homes',
      'Termite-proof and rot-proof',
      'Very lightweight and easy to handle',
      'Zero maintenance — no painting or sealing required',
      'Good for outdoor kitchens and utility areas',
    ],
    cons: [
      'Limited colour and finish options compared to laminates',
      'Can expand and contract with temperature changes',
      'Less rigid than wood-based boards — needs more support',
      'Not suitable for load-bearing shelves without reinforcement',
      'Fewer edge-banding options available',
    ],
    bestFor: ['Wet areas and utility kitchens', 'Coastal and high-humidity locations', 'Outdoor kitchens', 'Budget waterproof solutions'],
    durability: 3,
    waterResistance: 5,
    finishQuality: 2,
    maintenance: 'Wipe with any household cleaner. No special care needed. UV exposure may cause slight colour change over time.',
    warranty: '2-year warranty against manufacturing defects',
    lifespan: '10-15 years with proper installation',
    keyDifferentiator: 'The only 100% waterproof option — unbeatable for wet areas and coastal kitchens',
  },
  {
    id: 'plywood',
    name: 'Plywood (Marine-Grade / BWP)',
    shortName: 'Plywood',
    category: 'board',
    pricePerSqft: 550,
    minBudgetTier: 'standard',
    description: 'High-strength engineered wood made from cross-laminated veneers bonded with waterproof adhesive. The industry-standard choice for durable, long-lasting kitchen cabinetry in Sri Lanka.',
    pros: [
      'Excellent strength-to-weight ratio',
      'Boiling Water Proof (BWP) grade resists moisture well',
      'Holds screws and hinges very securely',
      'Long lifespan — 15+ years with proper care',
      'Can be laminated, painted, or veneered',
    ],
    cons: [
      'More expensive than MDF and melamine',
      'Surface grain may show through thin laminates',
      'Quality varies significantly between suppliers',
      'Heavy in large panel sizes',
      'Requires edge banding for a polished finish',
    ],
    bestFor: ['Family kitchens with daily use', 'Heavy-duty cabinetry', 'Humid environments', 'Long-term kitchen investments'],
    durability: 4,
    waterResistance: 3,
    finishQuality: 3,
    maintenance: 'Clean with mild detergent. Check edge banding annually. Keep hinges adjusted. Re-laminate after 10+ years if needed.',
    warranty: '5-year warranty on BWP-grade plywood',
    lifespan: '15-20 years with proper care',
    keyDifferentiator: 'The gold standard for Sri Lankan kitchens — best strength, longevity, and screw-holding of all board types',
  },
  {
    id: 'hpl',
    name: 'HPL (High Pressure Laminate)',
    shortName: 'HPL',
    category: 'laminate',
    pricePerSqft: 650,
    minBudgetTier: 'premium',
    description: 'Premium surface material manufactured under high heat and pressure. Extremely durable, scratch-resistant, and available in hundreds of designer finishes. Applied over plywood or MDF core.',
    pros: [
      'Highly scratch and impact resistant',
      'Hundreds of designer colours and textures',
      'Heat-resistant up to 180°C',
      'UV-resistant — does not fade in sunlight',
      'Antibacterial options available for hygiene-conscious clients',
    ],
    cons: [
      'Higher cost than standard laminates',
      'Cannot repair deep scratches — panel replacement needed',
      'Limited flexibility for curved designs',
      'Requires skilled installation for seamless joints',
      'Heavier edge-banding profile visible',
    ],
    bestFor: ['Premium residential kitchens', 'Showroom-quality displays', 'High-traffic family kitchens', 'Clients wanting designer finishes'],
    durability: 5,
    waterResistance: 4,
    finishQuality: 5,
    maintenance: 'Wipe clean with any household cleaner. Avoid abrasive scouring pads. Annual tightness check on hardware.',
    warranty: '7-year warranty against delamination and fading',
    lifespan: '18-25 years',
    keyDifferentiator: 'Highest durability among laminates — scratch and heat resistant for demanding kitchens',
  },
  {
    id: 'acrylic',
    name: 'Acrylic (High-Gloss Acrylic Finish)',
    shortName: 'Acrylic',
    category: 'acrylic',
    pricePerSqft: 750,
    minBudgetTier: 'premium',
    description: 'Premium high-gloss finish applied over MDF or plywood core. Creates a mirror-like, ultra-modern look. The top choice for luxury kitchen showrooms and contemporary Sri Lankan homes.',
    pros: [
      'Stunning mirror-like high-gloss finish',
      'Available in bold solid colours including pure white',
      'UV-resistant — maintains gloss for years',
      'Scratch-resistant surface (minor scratches buff out)',
      'Creates an open, spacious visual effect',
    ],
    cons: [
      'Highest cost per square foot',
      'Fingerprints and smudges visible — needs frequent wiping',
      'Deep scratches require professional refinishing',
      'Can appear cold/clinical if not balanced with warm accents',
      'Requires excellent lighting to showcase properly',
    ],
    bestFor: ['Luxury modern kitchens', 'Open-plan living spaces', 'Showroom-quality designs', 'Clients wanting a premium wow factor'],
    durability: 4,
    waterResistance: 4,
    finishQuality: 5,
    maintenance: 'Wipe daily with microfiber cloth. Use acrylic-safe cleaner. Avoid abrasive materials. Buff minor scratches with acrylic polish.',
    warranty: '5-year warranty on acrylic delamination and gloss retention',
    lifespan: '15-20 years with proper care',
    keyDifferentiator: 'Unmatched mirror-gloss luxury look — transforms kitchens into high-end showpieces',
  },
]

export const BUDGET_TIERS: BudgetTierInfo[] = [
  {
    tier: 'economy',
    minBudget: 150000,
    maxBudget: 300000,
    label: 'Economy Kitchen',
    recommendedMaterials: ['melamine', 'pvc'],
    description: 'Affordable, functional kitchen with basic materials. Ideal for rental units, starter homes, and low-moisture pantries.',
  },
  {
    tier: 'standard',
    minBudget: 300000,
    maxBudget: 550000,
    label: 'Standard Kitchen',
    recommendedMaterials: ['mdf', 'plywood'],
    description: 'Durable mid-range kitchen with quality board materials. Best value for family homes and daily-use kitchens.',
  },
  {
    tier: 'premium',
    minBudget: 550000,
    maxBudget: 1000000,
    label: 'Premium Kitchen',
    recommendedMaterials: ['plywood', 'hpl', 'acrylic'],
    description: 'High-end kitchen with premium finishes. Designer looks, superior durability, and enhanced accessories.',
  },
  {
    tier: 'luxury',
    minBudget: 1000000,
    maxBudget: 999999999,
    label: 'Luxury Kitchen',
    recommendedMaterials: ['acrylic', 'hpl'],
    description: 'Bespoke luxury kitchen with the finest materials, full accessories, premium appliances, and custom design features.',
  },
]

export const ACCESSORIES: AccessoryKnowledge[] = [
  { id: 'hinge-standard', name: 'Standard 3D Adjustable Hinges', category: 'Hinges', minPrice: 250, maxPrice: 400, description: 'Reliable 3D adjustable hinges with 110° opening. Zinc alloy construction.', recommendedFor: ['economy', 'standard'], notes: 'Per pair pricing. Suitable for most cabinet doors.' },
  { id: 'hinge-softclose', name: 'Soft-Close Hydraulic Hinges', category: 'Hinges', minPrice: 450, maxPrice: 750, description: 'Premium hydraulic soft-close hinges with silent closing mechanism. Prevents door slamming.', recommendedFor: ['standard', 'premium', 'luxury'], notes: 'Strongly recommended for family kitchens — eliminates door slam noise.' },
  { id: 'drawer-standard', name: 'Standard Ball-Bearing Drawer Channels', category: 'Drawers', minPrice: 350, maxPrice: 550, description: 'Smooth ball-bearing channels with 45kg load capacity. Full extension.', recommendedFor: ['economy', 'standard'], notes: 'Per pair. Good for cutlery and light storage drawers.' },
  { id: 'drawer-softclose', name: 'Premium Soft-Close Drawer Channels', category: 'Drawers', minPrice: 650, maxPrice: 1100, description: 'Full-extension soft-close drawer runners with 60kg capacity. Push-to-open option available.', recommendedFor: ['premium', 'luxury'], notes: 'Transforms kitchen experience — silent, smooth, luxurious.' },
  { id: 'handle-alu', name: 'Aluminium Standard Handles', category: 'Handles', minPrice: 150, maxPrice: 250, description: 'Brushed aluminium bar handles. Modern minimalist profile.', recommendedFor: ['economy', 'standard'], notes: 'Per piece. Available in 96mm, 128mm, and 192mm lengths.' },
  { id: 'handle-brass', name: 'Brass Designer Handles', category: 'Handles', minPrice: 350, maxPrice: 600, description: 'Solid brass handles with antique or polished finish. Adds warmth and character.', recommendedFor: ['premium', 'luxury'], notes: 'Per piece. Pairs beautifully with acrylic and HPL finishes.' },
  { id: 'basket-corner', name: 'Corner Pull-Out Basket (Magic Corner)', category: 'Storage', minPrice: 3500, maxPrice: 5500, description: 'Full-extension corner unit mechanism that pulls out and swivels. Maximises dead corner space.', recommendedFor: ['standard', 'premium', 'luxury'], notes: 'Essential for L-shape and U-shape kitchens. Transforms wasted corners into accessible storage.' },
  { id: 'basket-pullout', name: 'Heavy-Duty Pull-Out Basket', category: 'Storage', minPrice: 2500, maxPrice: 4000, description: 'Chrome-plated wire basket with full-extension runners. Available in 150mm to 400mm widths.', recommendedFor: ['standard', 'premium'], notes: 'Best for organising pots, pans, and dry goods. One per 600mm base unit.' },
  { id: 'sink-ss-single', name: 'Stainless Steel Single Bowl Sink', category: 'Sinks', minPrice: 3000, maxPrice: 5000, description: '304-grade stainless steel undermount sink. Single bowl with drainer grooves.', recommendedFor: ['economy', 'standard'], notes: 'Standard 600x450mm. Includes basket strainer and fixing clips.' },
  { id: 'sink-granite', name: 'Premium Granite Composite Sink', category: 'Sinks', minPrice: 8000, maxPrice: 14000, description: '80% granite stone composite sink. Scratch, stain, and heat resistant to 280°C.', recommendedFor: ['premium', 'luxury'], notes: 'Available in black, grey, and white. Includes accessories set.' },
  { id: 'tap-mixer', name: 'Chrome Kitchen Mixer Tap', category: 'Taps', minPrice: 3500, maxPrice: 5500, description: 'Single-lever chrome mixer with 360° swivel spout. Ceramic disc cartridge.', recommendedFor: ['standard', 'premium'], notes: 'Standard 35mm installation hole. 5-year cartridge warranty.' },
  { id: 'tap-pullout', name: 'Pull-Out Spray Kitchen Mixer', category: 'Taps', minPrice: 7500, maxPrice: 12000, description: 'Dual-function spray/stream pull-out mixer. Magnetic docking. Available in chrome, black, and brushed nickel.', recommendedFor: ['premium', 'luxury'], notes: 'Transforms sink usability — ideal for washing large pots and vegetables.' },
  { id: 'lighting-led', name: 'Under-Cabinet LED Strip Lighting', category: 'Lighting', minPrice: 2000, maxPrice: 3500, description: 'Warm white LED strip with aluminium profile and diffuser. 12V driver included.', recommendedFor: ['standard', 'premium', 'luxury'], notes: 'Per linear metre. Transforms kitchen ambience and task lighting quality.' },
  { id: 'lighting-puck', name: 'LED Puck Spotlights (Set of 4)', category: 'Lighting', minPrice: 1500, maxPrice: 2500, description: 'Surface-mounted LED puck lights. Warm white 3000K. 3W each.', recommendedFor: ['economy', 'standard'], notes: 'Simple upgrade for existing kitchens. Inside-cabinet lighting option.' },
  { id: 'tall-unit', name: 'Tall Unit Pull-Out Storage System', category: 'Storage', minPrice: 4000, maxPrice: 6500, description: 'Full-height pull-out pantry system with 5-tier baskets. Fits 300mm or 400mm wide units.', recommendedFor: ['premium', 'luxury'], notes: 'Space-efficient pantry solution. Replaces multiple wall cabinets.' },
  { id: 'tandem-box', name: 'Tandem Box Drawer System', category: 'Drawers', minPrice: 850, maxPrice: 1400, description: 'Metal-sided drawer box system with soft-close. Clean, contemporary look with high sides.', recommendedFor: ['premium', 'luxury'], notes: 'Per drawer. Available in white, grey, and anthracite. No visible runners.' },
]

export const FAQS: FAQEntry[] = [
  {
    id: 'faq-installation-time',
    question: 'How long does kitchen installation take?',
    answer: 'A standard kitchen installation takes 2-3 weeks from measurement confirmation. Complex kitchens with islands or U-shape layouts may take 3-4 weeks. This includes cabinet assembly, countertop templating and installation, hardware fitting, and final adjustments.',
    category: 'installation',
    keywords: ['how long', 'installation', 'install', 'time', 'duration', 'weeks', 'days', 'timeline', 'how much time', 'fitting'],
  },
  {
    id: 'faq-warranty',
    question: 'What warranty do you provide?',
    answer: 'We provide warranties ranging from 1 to 7 years depending on the material. Plywood carcasses carry a 5-year warranty, HPL finishes 7 years, Acrylic 5 years, MDF 3 years, Melamine 1 year, and PVC 2 years. All hardware (hinges, drawer channels) carries a 2-year warranty. The warranty covers manufacturing defects and delamination — it does not cover damage from misuse, water exposure beyond the material rating, or normal wear and tear.',
    category: 'warranty',
    keywords: ['warranty', 'guarantee', 'guarantee', 'cover', 'coverage', 'defects', 'damage', 'repair', 'replace'],
  },
  {
    id: 'faq-site-visit',
    question: 'Do you do free site visits?',
    answer: 'Yes, we offer a free site visit and measurement service for customers in Colombo, Gampaha, Negombo, Moratuwa, Dehiwala, Nugegoda, Kotte, and surrounding areas. During the visit our designer takes precise measurements, discusses your requirements, shows material samples, and provides a preliminary design sketch. Visits to areas outside our service zone may incur a small travel charge.',
    category: 'installation',
    keywords: ['site visit', 'visit', 'come', 'measuring', 'measurement', 'survey', 'inspection', 'check', 'see'],
  },
  {
    id: 'faq-payment-terms',
    question: 'What are your payment terms?',
    answer: 'Our standard payment structure is 40% advance to confirm the order and begin production, 30% upon delivery of materials to site, and 30% upon completion and handover. We accept cash, bank transfers, and online payments. All payments include a GST-compliant invoice.',
    category: 'payment',
    keywords: ['payment', 'pay', 'deposit', 'advance', 'terms', 'installment', 'finance', 'cost split', 'payments'],
  },
  {
    id: 'faq-design-process',
    question: 'How does the design process work?',
    answer: 'Our design process has four steps: 1) Free site visit and measurement, 2) 3D design and layout proposal showing your kitchen from multiple angles, 3) Material and colour selection at our showroom, 4) Final approval and production. Most designs are ready within 3-5 working days after measurement.',
    category: 'design',
    keywords: ['design', 'process', 'designing', 'draw', 'drawing', 'sketch', 'layout', 'plan', '3D', 'proposal'],
  },
  {
    id: 'faq-material-difference',
    question: 'What is the difference between MDF and Plywood?',
    answer: 'MDF offers a smoother surface ideal for painted finishes and is more affordable at around Rs.450/sqft. Plywood is stronger, holds screws better, and resists moisture more effectively at around Rs.550/sqft. For daily-use family kitchens we recommend BWP-grade Plywood. For budget-conscious projects with painted finishes, moisture-resistant MDF is a good alternative.',
    category: 'materials',
    keywords: ['difference', 'between', 'vs', 'versus', 'compare', 'comparison', 'mdf plywood', 'which is better', 'what material'],
  },
  {
    id: 'faq-acrylic-vs-hpl',
    question: 'What is the difference between Acrylic and HPL?',
    answer: 'Acrylic provides a mirror-like high-gloss finish ideal for modern luxury kitchens at around Rs.750/sqft. HPL offers superior scratch and heat resistance with hundreds of designer textures at around Rs.650/sqft. Choose Acrylic for visual impact, HPL for maximum durability. Both are premium options suitable for budgets above Rs.500,000.',
    category: 'materials',
    keywords: ['acrylic', 'hpl', 'difference', 'vs', 'versus', 'gloss', 'matte', 'finish', 'which finish', 'which looks better'],
  },
  {
    id: 'faq-maintenance',
    question: 'How do I maintain my kitchen cabinets?',
    answer: 'Wipe surfaces daily with a soft damp cloth and mild detergent. Avoid abrasive cleaners and scouring pads on all finishes. For Acrylic, use a microfiber cloth and acrylic-safe cleaner to prevent scratches. Check and tighten hinge screws every 6 months. Keep cabinets dry — wipe spills immediately, especially on MDF and Melamine edges.',
    category: 'maintenance',
    keywords: ['maintain', 'maintenance', 'clean', 'cleaning', 'care', 'look after', 'preserve', 'protect', 'keep clean'],
  },
  {
    id: 'faq-delivery',
    question: 'Do you deliver and install island-wide?',
    answer: 'We deliver and install kitchens across Sri Lanka. Our primary service area includes Colombo, Gampaha, Negombo, Kalutara, and Kandy regions with no additional travel charge. Deliveries to other areas include a transport charge based on distance. All deliveries include full installation by our trained fitting team.',
    category: 'delivery',
    keywords: ['delivery', 'deliver', 'shipping', 'transport', 'island wide', 'all island', 'areas', 'locations', 'regions'],
  },
  {
    id: 'faq-pricing-range',
    question: 'How much does a kitchen cost?',
    answer: 'Kitchen costs vary by size, material, and accessories. Economy kitchens start from Rs.150,000 for basic layouts. Standard family kitchens range from Rs.300,000 to Rs.550,000. Premium kitchens with Acrylic or HPL finishes range from Rs.550,000 to Rs.1,000,000. Luxury bespoke kitchens exceed Rs.1,000,000. A free site visit helps us give you an exact quotation.',
    category: 'pricing',
    keywords: ['cost', 'price', 'pricing', 'how much', 'rate', 'budget', 'affordable', 'expensive', 'cheap', 'estimate', 'quotation'],
  },
  {
    id: 'faq-custom-design',
    question: 'Can you do custom kitchen designs?',
    answer: 'Yes, we specialise in fully custom kitchen designs. Our designers work with your space dimensions, style preferences, and budget to create a unique kitchen layout. We handle non-standard room shapes, sloped ceilings, open-plan layouts, and specific accessibility requirements. Every kitchen we build is unique.',
    category: 'design',
    keywords: ['custom', 'bespoke', 'unique', 'designer', 'designed', 'special', 'tailored', 'customized', 'personalised'],
  },
  {
    id: 'faq-after-sales',
    question: 'What after-sales support do you provide?',
    answer: 'We provide 1 year of free after-sales service including hinge adjustments, drawer alignment, and minor touch-ups. After the first year we offer paid service visits. All hardware and materials remain covered under their respective warranties (1-7 years). Simply WhatsApp or call us and we will schedule a visit.',
    category: 'general',
    keywords: ['after sales', 'service', 'support', 'repair', 'fix', 'issue', 'problem', 'broken', 'adjustment', 'touch up'],
  },
  {
    id: 'faq-how-to-start',
    question: 'How do I get started?',
    answer: 'Simply share your name, location, preferred kitchen type, and approximate budget. We will arrange a free site visit, take measurements, and provide a 3D design and quotation — all with no obligation. You can also visit our showroom to see material samples and completed kitchen displays.',
    category: 'general',
    keywords: ['start', 'begin', 'get started', 'how to', 'process', 'steps', 'next', 'what now', 'interested'],
  },
]

export const COMPANY: CompanyKnowledge = {
  name: 'Kitchen Pantry',
  tagline: 'Your dream kitchen, crafted with care',
  services: [
    'Free site visit and measurement',
    '3D kitchen design and layout planning',
    'Custom kitchen manufacturing',
    'Professional installation',
    'Material and colour consultation',
    'Accessory and hardware selection guidance',
    'After-sales service and maintenance',
    'Kitchen renovation and upgrades',
  ],
  warrantyTerms: 'Material warranties range from 1 to 7 years depending on material type. Hardware carries a 2-year warranty. Warranty covers manufacturing defects and delamination. Excludes damage from misuse, water exposure beyond material rating, or normal wear.',
  installationTimeStandard: '2-3 weeks from measurement confirmation',
  installationTimeComplex: '3-4 weeks for complex layouts',
  deliveryInfo: 'Free delivery and installation in Colombo, Gampaha, Negombo, and Kandy regions. Island-wide delivery available with transport charge based on distance. All orders include full installation by our trained team.',
  paymentTerms: '40% advance to confirm order, 30% upon material delivery to site, 30% upon completion and handover. All payments include GST invoice.',
  paymentMethods: 'Cash, bank transfer, and online payments accepted',
  serviceAreas: [
    'Colombo',
    'Gampaha',
    'Negombo',
    'Moratuwa',
    'Dehiwala',
    'Nugegoda',
    'Kotte',
    'Kandy',
    'Kalutara',
    'Kurunegala',
  ],
  siteVisitInfo: 'Free site visit within our primary service areas. Our designer brings material samples, takes precise measurements, and provides a preliminary layout sketch during the visit.',
  designProcess: '1) Free site visit and measurement, 2) 3D design proposal (3-5 working days), 3) Material and colour selection at showroom, 4) Final approval and production start.',
  afterSalesSupport: '1 year free after-sales service (adjustments, minor touch-ups). Paid service visits thereafter. Hardware covered under respective warranties.',
  certifications: ['ISO 9001 certified manufacturing process', 'FSC-certified timber sourcing', 'Member of Sri Lanka Kitchen Association'],
  experience: 'Over 10 years of kitchen manufacturing experience in Sri Lanka',
}
