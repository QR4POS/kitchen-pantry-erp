"use client"

import { useState, useMemo, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Calculator,
  RotateCcw,
  Ruler,
  Layers,
  Wrench,
  Save,
  Send,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Percent,
  IndianRupee,
  Truck,
  Zap,
  Droplets,
  Settings,
  ChevronRight,
  ChevronLeft,
  FileText,
} from "lucide-react"
import { KitchenType, MaterialType, Role } from "@/types"
import { calculateEstimation, type EstimateInput, recalculateWithProfit, estimateToItems } from "@/lib/estimation/engine"
import type {
  EstimationResult,
  KitchenDimensions,
  AdditionalCost,
  DiscountInfo,
  CabinetCalculation,
  MeasureUnit,
} from "@/types/estimation"
import { cn } from "@/utils/cn"
import { formatCurrency } from "@/lib/auth/helpers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

interface EstimateBuilderProps {
  projectId?: string
  customerId?: string
  onSave?: (result: EstimationResult) => void
  initialDimensions?: Partial<KitchenDimensions>
  readOnly?: boolean
  showActions?: boolean
}

const KITCHEN_TYPES = [
  { value: KitchenType.Straight, label: "Straight Kitchen" },
  { value: KitchenType.LShape, label: "L-Shape Kitchen" },
  { value: KitchenType.UShape, label: "U-Shape Kitchen" },
  { value: KitchenType.Island, label: "Island Kitchen" },
  { value: KitchenType.Parallel, label: "Parallel Kitchen" },
]

const MATERIALS = [
  { value: MaterialType.MDF, label: "MDF" },
  { value: MaterialType.Plywood, label: "Plywood" },
  { value: MaterialType.Melamine, label: "Melamine" },
  { value: MaterialType.Acrylic, label: "Acrylic" },
  { value: MaterialType.HPL, label: "HPL" },
  { value: MaterialType.PVC, label: "PVC" },
]

const UNITS: { value: MeasureUnit; label: string }[] = [
  { value: "feet", label: "Feet" },
  { value: "meters", label: "Meters" },
  { value: "inches", label: "Inches" },
]

const ADDITIONAL_COST_TYPES = [
  { value: "transportation", label: "Transportation", icon: Truck },
  { value: "installation", label: "Installation", icon: Zap },
  { value: "electrical", label: "Electrical", icon: Zap },
  { value: "plumbing", label: "Plumbing", icon: Droplets },
  { value: "custom", label: "Custom", icon: Settings },
]

const SAMPLE_ACCESSORIES = [
  { id: "hinge-standard", name: "Hinge - Standard", category: "Hinges", contractorPrice: 60, customerPrice: 100 },
  { id: "hinge-hydraulic", name: "Hinge - Hydraulic", category: "Hinges", contractorPrice: 120, customerPrice: 200 },
  { id: "drawer-standard", name: "Drawer Slide - Standard", category: "Drawers", contractorPrice: 250, customerPrice: 400 },
  { id: "drawer-premium", name: "Drawer Slide - Soft Close", category: "Drawers", contractorPrice: 450, customerPrice: 750 },
  { id: "handle-ss", name: "Handle - SS", category: "Hardware", contractorPrice: 150, customerPrice: 250 },
  { id: "handle-brass", name: "Handle - Brass", category: "Hardware", contractorPrice: 300, customerPrice: 500 },
  { id: "basket-corner", name: "Basket - Corner", category: "Storage", contractorPrice: 2200, customerPrice: 3500 },
  { id: "basket-cutlery", name: "Basket - Cutlery", category: "Storage", contractorPrice: 600, customerPrice: 1000 },
  { id: "sink-ss", name: "Sink - SS Single", category: "Plumbing", contractorPrice: 2500, customerPrice: 4000 },
  { id: "sink-ss-double", name: "Sink - SS Double", category: "Plumbing", contractorPrice: 4000, customerPrice: 6500 },
  { id: "tap-mixer", name: "Mixer - Kitchen", category: "Plumbing", contractorPrice: 3500, customerPrice: 5500 },
  { id: "lighting-led", name: "LED Strip Light", category: "Lighting", contractorPrice: 500, customerPrice: 800 },
  { id: "chimney", name: "Chimney", category: "Appliances", contractorPrice: 8500, customerPrice: 14000 },
  { id: "hob", name: "Hob", category: "Appliances", contractorPrice: 12000, customerPrice: 19000 },
  { id: "tower-unit", name: "Tower Unit", category: "Storage", contractorPrice: 4500, customerPrice: 7000 },
]

export function EstimateBuilder({
  projectId,
  onSave,
  initialDimensions,
  readOnly = false,
  showActions = true,
}: EstimateBuilderProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [dimensions, setDimensions] = useState<KitchenDimensions>({
    length: initialDimensions?.length ?? 0,
    width: initialDimensions?.width ?? 0,
    height: initialDimensions?.height ?? 0,
    kitchen_type: initialDimensions?.kitchen_type ?? KitchenType.Straight,
    num_cabinets: initialDimensions?.num_cabinets ?? 0,
    num_drawers: initialDimensions?.num_drawers ?? 0,
    num_doors: initialDimensions?.num_doors ?? 0,
    countertop_length: initialDimensions?.countertop_length ?? 0,
    island_length: initialDimensions?.island_length ?? 0,
    unit: initialDimensions?.unit ?? "feet",
    notes: initialDimensions?.notes ?? "",
  })

  const [material, setMaterial] = useState<MaterialType>(MaterialType.Plywood)
  const [selectedAccessories, setSelectedAccessories] = useState<Record<string, number>>({})
  const [additionalCosts, setAdditionalCosts] = useState<AdditionalCost[]>([])
  const [newCostName, setNewCostName] = useState("")
  const [newCostAmount, setNewCostAmount] = useState(0)
  const [newCostType, setNewCostType] = useState<AdditionalCost['type']>("transportation")
  const [newCostIsPct, setNewCostIsPct] = useState(false)
  const [newCostPctValue, setNewCostPctValue] = useState(0)

  const [laborPct, setLaborPct] = useState(25)
  const [useFixedLabor, setUseFixedLabor] = useState(false)
  const [fixedLabor, setFixedLabor] = useState(0)

  const [profitPct, setProfitPct] = useState(30)
  const [useFixedProfit, setUseFixedProfit] = useState(false)
  const [fixedProfit, setFixedProfit] = useState(0)

  const [discountType, setDiscountType] = useState<'none' | 'fixed' | 'percentage'>('none')
  const [discountValue, setDiscountValue] = useState(0)
  const [discountDesc, setDiscountDesc] = useState("")

  const [taxes, setTaxes] = useState<{ name: string; rate: number }[]>([])
  const [newTaxName, setNewTaxName] = useState("")
  const [newTaxRate, setNewTaxRate] = useState(0)

  const [customerPriceOverride, setCustomerPriceOverride] = useState<number | null>(null)

  const { addToast } = useToast()

  const calcInput: EstimateInput = useMemo(() => ({
    dimensions,
    material,
    selectedAccessories: Object.entries(selectedAccessories)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => {
        const acc = SAMPLE_ACCESSORIES.find(a => a.id === id)
        return acc ? { id, quantity: qty, name: acc.name, contractorPrice: acc.contractorPrice, customerPrice: acc.customerPrice } : null
      })
      .filter(Boolean) as { id: string; quantity: number; name: string; contractorPrice: number; customerPrice: number }[],
    additionalCosts: additionalCosts.filter(c => c.amount > 0 || c.percentageValue),
    discount: discountType !== 'none' ? { type: discountType as 'fixed' | 'percentage', value: discountValue, description: discountDesc } : null,
    taxes: taxes.filter(t => t.rate > 0),
    laborPercentage: laborPct / 100,
    profitPercentage: profitPct / 100,
    useFixedLabor,
    laborFixed: fixedLabor,
  }), [dimensions, material, selectedAccessories, additionalCosts, discountType, discountValue, discountDesc, taxes, laborPct, useFixedLabor, fixedLabor, profitPct])

  const result = useMemo(() => calculateEstimation(calcInput), [calcInput])

  const steps = [
    { id: 'measurements', label: 'Measurements', icon: Ruler },
    { id: 'layout', label: 'Layout & Material', icon: Layers },
    { id: 'accessories', label: 'Accessories', icon: Wrench },
    { id: 'costs', label: 'Additional Costs', icon: Calculator },
    { id: 'pricing', label: 'Pricing', icon: Percent },
    { id: 'preview', label: 'Preview', icon: FileText },
  ]

  const updateDimension = (field: keyof KitchenDimensions, value: number | string | KitchenType | MeasureUnit) => {
    setDimensions(prev => ({ ...prev, [field]: value }))
  }

  const toggleAccessory = (id: string) => {
    setSelectedAccessories(prev => ({
      ...prev,
      [id]: prev[id] ? 0 : 1,
    }))
  }

  const updateAccessoryQty = (id: string, qty: number) => {
    if (qty < 0) return
    setSelectedAccessories(prev => ({ ...prev, [id]: qty }))
  }

  const addAdditionalCost = () => {
    if (!newCostName) return
    setAdditionalCosts(prev => [
      ...prev,
      {
        id: `cost-${Date.now()}`,
        name: newCostName,
        amount: newCostAmount,
        type: newCostType,
        isPercentage: newCostIsPct,
        percentageValue: newCostIsPct ? newCostPctValue : undefined,
      },
    ])
    setNewCostName("")
    setNewCostAmount(0)
    setNewCostIsPct(false)
    setNewCostPctValue(0)
  }

  const removeAdditionalCost = (id: string) => {
    setAdditionalCosts(prev => prev.filter(c => c.id !== id))
  }

  const addTax = () => {
    if (!newTaxName || newTaxRate <= 0) return
    setTaxes(prev => [...prev, { name: newTaxName, rate: newTaxRate }])
    setNewTaxName("")
    setNewTaxRate(0)
  }

  const removeTax = (name: string) => {
    setTaxes(prev => prev.filter(t => t.name !== name))
  }

  const handleProfitChange = (value: number) => {
    if (useFixedProfit) {
      const totalCost = result.totalContractorCost
      const pct = totalCost > 0 ? (value / totalCost) * 100 : 0
      setProfitPct(Math.round(pct))
      setFixedProfit(value)
    } else {
      setProfitPct(value)
    }
  }

  const handleCustomerPriceChange = (price: number) => {
    setCustomerPriceOverride(price)
    const contractorCost = result.totalContractorCost
    const profit = price - contractorCost
    const pct = contractorCost > 0 ? (profit / contractorCost) * 100 : 0
    setProfitPct(Math.round(pct))
  }

  const resetAll = () => {
    setDimensions({
      length: 0, width: 0, height: 0,
      kitchen_type: KitchenType.Straight,
      num_cabinets: 0, num_drawers: 0, num_doors: 0,
      countertop_length: 0, island_length: 0,
      unit: 'feet', notes: '',
    })
    setMaterial(MaterialType.Plywood)
    setSelectedAccessories({})
    setAdditionalCosts([])
    setLaborPct(25)
    setUseFixedLabor(false)
    setFixedLabor(0)
    setProfitPct(30)
    setDiscountType('none')
    setDiscountValue(0)
    setTaxes([])
    setCurrentStep(0)
  }

  const handleSave = () => {
    onSave?.(result)
    addToast({ title: "Estimate calculated", description: "Ready to save to database." })
  }

  const canProceed = useMemo(() => {
    if (currentStep === 0) return dimensions.length > 0 && dimensions.width > 0 && dimensions.height > 0
    return true
  }, [currentStep, dimensions])

  const renderStep = () => {
    switch (currentStep) {
      case 0: return renderMeasurements()
      case 1: return renderLayoutMaterial()
      case 2: return renderAccessories()
      case 3: return renderAdditionalCosts()
      case 4: return renderPricing()
      case 5: return renderPreview()
      default: return null
    }
  }

  function renderMeasurements() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Ruler className="size-5" />
            Kitchen Measurements
          </h3>
          <p className="text-sm text-muted-foreground">Enter the dimensions of the kitchen space</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Length</Label>
            <div className="relative">
              <Input
                type="number" step="0.1"
                placeholder="e.g. 12"
                value={dimensions.length || ""}
                onChange={e => updateDimension('length', parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Width</Label>
            <Input
              type="number" step="0.1"
              placeholder="e.g. 10"
              value={dimensions.width || ""}
              onChange={e => updateDimension('width', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Height</Label>
            <Input
              type="number" step="0.1"
              placeholder="e.g. 7"
              value={dimensions.height || ""}
              onChange={e => updateDimension('height', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Unit</Label>
            <Select value={dimensions.unit} onValueChange={(v) => updateDimension('unit', v as MeasureUnit)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map(u => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Countertop Length (optional)</Label>
            <Input
              type="number" step="0.1"
              placeholder="e.g. 12"
              value={dimensions.countertop_length || ""}
              onChange={e => updateDimension('countertop_length', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Number of Cabinets</Label>
            <Input
              type="number"
              placeholder="e.g. 8"
              value={dimensions.num_cabinets || ""}
              onChange={e => updateDimension('num_cabinets', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Number of Drawers</Label>
            <Input
              type="number"
              placeholder="e.g. 4"
              value={dimensions.num_drawers || ""}
              onChange={e => updateDimension('num_drawers', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Number of Doors</Label>
            <Input
              type="number"
              placeholder="e.g. 10"
              value={dimensions.num_doors || ""}
              onChange={e => updateDimension('num_doors', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Notes (optional)</Label>
          <Textarea
            placeholder="Additional measurement notes..."
            value={dimensions.notes ?? ""}
            onChange={e => updateDimension('notes', e.target.value)}
          />
        </div>
      </div>
    )
  }

  function renderLayoutMaterial() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="size-5" />
            Layout & Material
          </h3>
          <p className="text-sm text-muted-foreground">Select kitchen layout and material type</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Kitchen Type</Label>
            <Select value={dimensions.kitchen_type} onValueChange={(v) => updateDimension('kitchen_type', v as KitchenType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KITCHEN_TYPES.map(kt => (
                  <SelectItem key={kt.value} value={kt.value}>{kt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Material Type</Label>
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATERIALS.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {dimensions.kitchen_type === KitchenType.Island && (
          <div className="space-y-2">
            <Label>Island Length (ft)</Label>
            <Input
              type="number" step="0.1"
              placeholder="e.g. 6"
              value={dimensions.island_length || ""}
              onChange={e => updateDimension('island_length', parseFloat(e.target.value) || 0)}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Calculated Area</p>
              <p className="text-2xl font-bold">{result.areaCalculated.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">sq.ft</span></p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Material Cost (est.)</p>
              <p className="text-2xl font-bold">{formatCurrency(result.totalMaterialsCost)}</p>
            </CardContent>
          </Card>
        </div>

        {result.cabinetCalculations.length > 0 && (
          <div>
            <Label className="mb-2 block">Cabinet Breakdown</Label>
            <div className="space-y-2">
              {result.cabinetCalculations.map((cab, i) => (
                <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-muted/50 text-sm">
                  <span className="capitalize">{cab.type} Cabinet ({(cab.area).toFixed(1)} sq.ft)</span>
                  <span className="font-medium">{formatCurrency(Math.round(cab.total))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderAccessories() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Wrench className="size-5" />
            Accessories
          </h3>
          <p className="text-sm text-muted-foreground">Select accessories and fittings</p>
        </div>

        <div className="space-y-2">
          {SAMPLE_ACCESSORIES.map(acc => (
            <div
              key={acc.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                selectedAccessories[acc.id] ? "border-primary bg-primary/5" : "hover:bg-accent"
              )}
            >
              <Checkbox
                checked={!!selectedAccessories[acc.id]}
                onCheckedChange={() => toggleAccessory(acc.id)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{acc.name}</p>
                <p className="text-xs text-muted-foreground">{acc.category}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAccessories[acc.id] && (
                  <div className="flex items-center gap-1">
                    <button
                      className="size-6 rounded border text-xs"
                      onClick={() => updateAccessoryQty(acc.id, Math.max(0, selectedAccessories[acc.id] - 1))}
                    >-</button>
                    <span className="w-6 text-center text-sm">{selectedAccessories[acc.id]}</span>
                    <button
                      className="size-6 rounded border text-xs"
                      onClick={() => updateAccessoryQty(acc.id, selectedAccessories[acc.id] + 1)}
                    >+</button>
                  </div>
                )}
                <span className="text-sm font-medium w-24 text-right">{formatCurrency(acc.contractorPrice)}</span>
              </div>
            </div>
          ))}
        </div>

        {result.totalAccessoriesCost > 0 && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">Total Accessories Cost</p>
                <p className="text-xl font-bold">{formatCurrency(result.totalAccessoriesCost)}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  function renderAdditionalCosts() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calculator className="size-5" />
            Additional Costs
          </h3>
          <p className="text-sm text-muted-foreground">Add transportation, installation, and other charges</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-5">
          <div className="space-y-2 sm:col-span-2">
            <Label>Cost Name</Label>
            <Input
              placeholder="e.g. Transportation"
              value={newCostName}
              onChange={e => setNewCostName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={newCostType} onValueChange={(v) => setNewCostType(v as AdditionalCost['type'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADDITIONAL_COST_TYPES.map(ct => (
                  <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{newCostIsPct ? "Percentage %" : "Amount"}</Label>
            <Input
              type="number"
              value={newCostIsPct ? newCostPctValue || "" : newCostAmount || ""}
              onChange={e => {
                const val = parseFloat(e.target.value) || 0
                if (newCostIsPct) setNewCostPctValue(val)
                else setNewCostAmount(val)
              }}
            />
          </div>
          <div className="space-y-2 flex items-end">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setNewCostIsPct(!newCostIsPct)}>
                <Percent className="size-3 mr-1" />
                {newCostIsPct ? "Fixed" : "%"}
              </Button>
              <Button size="sm" onClick={addAdditionalCost} disabled={!newCostName}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {additionalCosts.length > 0 && (
          <div className="space-y-2">
            {additionalCosts.map(cost => (
              <div key={cost.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{cost.type}</Badge>
                  <span className="text-sm font-medium">{cost.name}</span>
                  {cost.isPercentage && <span className="text-xs text-muted-foreground">({cost.percentageValue}%)</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{formatCurrency(cost.amount)}</span>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => removeAdditionalCost(cost.id)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Labour Calculation</Label>
            <div className="flex items-center gap-3">
              <Select value={useFixedLabor ? "fixed" : "percentage"} onValueChange={(v) => setUseFixedLabor(v === "fixed")}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
              {useFixedLabor ? (
                <Input
                  type="number" className="w-32"
                  placeholder="Amount"
                  value={fixedLabor || ""}
                  onChange={e => setFixedLabor(parseFloat(e.target.value) || 0)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number" className="w-20"
                    value={laborPct}
                    onChange={e => setLaborPct(parseFloat(e.target.value) || 0)}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderPricing() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Percent className="size-5" />
            Pricing & Profit
          </h3>
          <p className="text-sm text-muted-foreground">Set profit margin, discounts, and taxes</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Profit Margin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="number" className="w-20"
                    value={profitPct}
                    onChange={e => handleProfitChange(parseFloat(e.target.value) || 0)}
                  />
                  <span className="text-sm">%</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Contractor Cost</span>
                  <span className="font-medium">{formatCurrency(result.totalContractorCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Profit Amount</span>
                  <span className="font-medium text-emerald-600">{formatCurrency(result.companyProfit)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="font-medium">Customer Price</span>
                  <span className="text-lg font-bold text-primary">{formatCurrency(result.customerPrice)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Discount</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'none' | 'fixed' | 'percentage')}>
                  <SelectTrigger>
                    <SelectValue placeholder="No discount" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Discount</SelectItem>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
                {discountType !== 'none' && (
                  <>
                    <Input
                      type="number"
                      placeholder={discountType === 'fixed' ? "Amount" : "Percentage %"}
                      value={discountValue || ""}
                      onChange={e => setDiscountValue(parseFloat(e.target.value) || 0)}
                    />
                    <Input
                      placeholder="Discount description (optional)"
                      value={discountDesc}
                      onChange={e => setDiscountDesc(e.target.value)}
                    />
                    {result.discountAmount > 0 && (
                      <p className="text-sm text-amber-600">Discount: -{formatCurrency(result.discountAmount)}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Taxes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Tax name"
                    value={newTaxName}
                    onChange={e => setNewTaxName(e.target.value)}
                  />
                  <Input
                    type="number" className="w-20"
                    placeholder="%"
                    value={newTaxRate || ""}
                    onChange={e => setNewTaxRate(parseFloat(e.target.value) || 0)}
                  />
                  <Button size="sm" onClick={addTax} disabled={!newTaxName || newTaxRate <= 0}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                {taxes.map(tax => (
                  <div key={tax.name} className="flex items-center justify-between text-sm">
                    <span>{tax.name} ({tax.rate}%)</span>
                    <Button variant="ghost" size="icon" className="size-6" onClick={() => removeTax(tax.name)}>
                      <Trash2 className="size-3 text-destructive" />
                    </Button>
                  </div>
                ))}
                {result.taxAmount > 0 && (
                  <p className="text-sm text-muted-foreground">Tax Total: {formatCurrency(result.taxAmount)}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-muted-foreground">Final Price (incl. discount & tax)</p>
                <p className="text-3xl font-bold text-primary">{formatCurrency(result.finalPrice)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Contractor Cost</p>
                <p className="text-sm font-medium">{formatCurrency(result.totalContractorCost)}</p>
                <p className="text-xs text-muted-foreground mt-1">Profit ({result.profitPercentage}%)</p>
                <p className="text-sm font-medium text-emerald-600">{formatCurrency(result.companyProfit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderPreview() {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="size-5" />
            Estimate Preview
          </h3>
          <p className="text-sm text-muted-foreground">Complete breakdown of the estimate</p>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.breakdownItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant={item.isContractorCost ? "secondary" : "default"}>
                        {item.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{item.description}</TableCell>
                    <TableCell className="text-right">{item.quantity.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell className={cn("text-right font-medium", item.totalPrice < 0 && "text-amber-600")}>
                      {item.totalPrice < 0 ? `-${formatCurrency(Math.abs(item.totalPrice))}` : formatCurrency(item.totalPrice)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">Contractor Cost</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(result.totalContractorCost)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">Profit ({result.profitPercentage}%)</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(result.companyProfit)}</TableCell>
                </TableRow>
                {result.discountAmount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">Discount</TableCell>
                    <TableCell className="text-right font-semibold text-amber-600">-{formatCurrency(result.discountAmount)}</TableCell>
                  </TableRow>
                )}
                {result.taxAmount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">Tax</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(result.taxAmount)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-bold text-lg">Final Price</TableCell>
                  <TableCell className="text-right font-bold text-lg text-primary">{formatCurrency(result.finalPrice)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Total Area</p>
              <p className="text-xl font-bold">{result.areaCalculated.toFixed(1)} sq.ft</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Profit Margin</p>
              <p className="text-xl font-bold text-emerald-600">{result.profitPercentage}%</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Total Items</p>
              <p className="text-xl font-bold">{result.breakdownItems.length}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => setCurrentStep(i)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors",
              currentStep === i
                ? "bg-primary text-primary-foreground font-medium"
                : i < currentStep
                  ? "text-muted-foreground hover:bg-accent"
                  : "text-muted-foreground/50"
            )}
          >
            <step.icon className="size-4" />
            <span className="hidden sm:inline">{step.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      {showActions && (
        <div className="flex items-center justify-between pt-4 border-t">
          <div>
            {result.totalContractorCost > 0 && (
              <p className="text-xs text-muted-foreground">
                Final: <span className="font-semibold text-foreground">{formatCurrency(result.finalPrice)}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetAll}>
              <RotateCcw className="size-3 mr-1" />
              Reset
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={currentStep === 0}
              onClick={() => setCurrentStep(p => p - 1)}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            {currentStep < steps.length - 1 ? (
              <Button size="sm" onClick={() => setCurrentStep(p => p + 1)} disabled={!canProceed}>
                Next
                <ChevronRight className="size-4 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleSave}>
                <Save className="size-4 mr-1" />
                Save Estimate
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
