"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion, AnimatePresence } from "framer-motion"
import { Calculator, RotateCcw, Ruler, Layers, Wrench } from "lucide-react"
import { KitchenType, MaterialType } from "@/types"
import { MaterialRates, AccessoryRates, type EstimationResult } from "@/types/estimation"
import { cn } from "@/utils/cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

const estimationFormSchema = z.object({
  length: z.coerce.number().positive("Length must be positive"),
  width: z.coerce.number().positive("Width must be positive"),
  height: z.coerce.number().positive("Height must be positive"),
  kitchen_type: z.nativeEnum(KitchenType),
  material_type: z.nativeEnum(MaterialType),
  accessories: z.array(z.string()),
})

type EstimationFormInput = z.infer<typeof estimationFormSchema>

function calculateEstimation(data: EstimationFormInput): EstimationResult {
  const area = data.length * data.height
  const perimeter = 2 * (data.length + data.width)
  const materialRate = MaterialRates.find((m) => m.material_type === data.material_type)!

  const typeMultiplier: Record<KitchenType, number> = {
    [KitchenType.Straight]: 1.0,
    [KitchenType.LShape]: 1.15,
    [KitchenType.UShape]: 1.3,
    [KitchenType.Island]: 1.2,
    [KitchenType.Parallel]: 1.1,
  }
  const kitchenMultiplier = typeMultiplier[data.kitchen_type]

  const baseMaterialCost = area * materialRate.base_cost_per_sqft * materialRate.multiplier * kitchenMultiplier
  const laborCost = area * 120 * kitchenMultiplier
  const finishingCost = perimeter * 450 * kitchenMultiplier
  const hardwareCost = 2500 * kitchenMultiplier

  let accessoriesCost = 0
  const selectedAccessories = AccessoryRates.filter((a) => data.accessories.includes(a.name))
  for (const acc of selectedAccessories) {
    accessoriesCost += acc.contractorPrice
  }

  const totalMaterialsCost = baseMaterialCost + finishingCost + hardwareCost
  const totalContractorCost = totalMaterialsCost + laborCost + accessoriesCost
  const companyProfit = totalContractorCost * 0.25
  const customerPrice = totalContractorCost + companyProfit

  return {
    totalContractorCost: Math.round(totalContractorCost),
    totalMaterialsCost: Math.round(totalMaterialsCost),
    totalAccessoriesCost: Math.round(accessoriesCost),
    laborCost: Math.round(laborCost),
    companyProfit: Math.round(companyProfit),
    profitPercentage: 25,
    customerPrice: Math.round(customerPrice),
    additionalCosts: [],
    discount: null,
    discountAmount: 0,
    taxes: [],
    taxAmount: 0,
    finalPrice: Math.round(customerPrice),
    cabinetCalculations: [],
    areaCalculated: Math.round(area),
    breakdownItems: [
      {
        category: "Materials",
        description: `${materialRate.material_type} - Base Cost`,
        quantity: Math.round(area),
        unitPrice: Math.round(materialRate.base_cost_per_sqft * materialRate.multiplier * kitchenMultiplier),
        totalPrice: Math.round(baseMaterialCost),
        isContractorCost: true,
      },
      {
        category: "Labor",
        description: "Fabrication & Installation",
        quantity: Math.round(area),
        unitPrice: 120,
        totalPrice: Math.round(laborCost),
        isContractorCost: true,
      },
      {
        category: "Finishing",
        description: "Edge Banding & Polish",
        quantity: Math.round(perimeter),
        unitPrice: 450,
        totalPrice: Math.round(finishingCost),
        isContractorCost: true,
      },
      {
        category: "Hardware",
        description: "Standard Hardware Kit",
        quantity: 1,
        unitPrice: Math.round(hardwareCost),
        totalPrice: Math.round(hardwareCost),
        isContractorCost: true,
      },
      ...selectedAccessories.map((acc) => ({
        category: "Accessories",
        description: acc.name,
        quantity: 1,
        unitPrice: acc.contractorPrice,
        totalPrice: acc.contractorPrice,
        isContractorCost: true,
      })),
      {
        category: "Profit",
        description: "Company Profit (25%)",
        quantity: 1,
        unitPrice: Math.round(companyProfit),
        totalPrice: Math.round(companyProfit),
        isContractorCost: false,
      },
    ],
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 0,
  }).format(amount)
}

export function EstimationForm() {
  const [result, setResult] = useState<EstimationResult | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<EstimationFormInput>({
    resolver: zodResolver(estimationFormSchema),
    defaultValues: {
      length: undefined,
      width: undefined,
      height: undefined,
      kitchen_type: KitchenType.Straight,
      material_type: MaterialType.Plywood,
      accessories: [],
    },
  })

  const selectedAccessories = watch("accessories")

  const handleAccessoryToggle = (name: string, checked: boolean) => {
    const current = watch("accessories")
    if (checked) {
      setValue("accessories", [...current, name])
    } else {
      setValue("accessories", current.filter((a) => a !== name))
    }
  }

  const onSubmit = (data: EstimationFormInput) => {
    setIsCalculating(true)
    const estResult = calculateEstimation(data)
    setTimeout(() => {
      setResult(estResult)
      setIsCalculating(false)
    }, 600)
  }

  const handleReset = () => {
    reset()
    setResult(null)
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="size-5" />
              Kitchen Dimensions
            </CardTitle>
            <CardDescription>Enter the measurements and configuration for your kitchen</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="estimation-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="length">Length (ft)</Label>
                  <Input
                    id="length"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 12"
                    {...register("length", { valueAsNumber: true })}
                    className={cn(errors.length && "border-destructive")}
                  />
                  {errors.length && <p className="text-xs text-destructive">{errors.length.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="width">Width (ft)</Label>
                  <Input
                    id="width"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 10"
                    {...register("width", { valueAsNumber: true })}
                    className={cn(errors.width && "border-destructive")}
                  />
                  {errors.width && <p className="text-xs text-destructive">{errors.width.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height">Height (ft)</Label>
                  <Input
                    id="height"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 7"
                    {...register("height", { valueAsNumber: true })}
                    className={cn(errors.height && "border-destructive")}
                  />
                  {errors.height && <p className="text-xs text-destructive">{errors.height.message}</p>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Kitchen Type</Label>
                  <Select
                    defaultValue={KitchenType.Straight}
                    onValueChange={(v) => setValue("kitchen_type", v as KitchenType)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(KitchenType).map((type) => (
                        <SelectItem key={type} value={type}>
                          {type === KitchenType.LShape ? "L-Shape" : type === KitchenType.UShape ? "U-Shape" : type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Material Type</Label>
                  <Select
                    defaultValue={MaterialType.Plywood}
                    onValueChange={(v) => setValue("material_type", v as MaterialType)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select material" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(MaterialType).map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Wrench className="size-4" />
                  Accessories
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AccessoryRates.map((acc) => (
                    <label
                      key={acc.name}
                      className={cn(
                        "flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors hover:bg-accent",
                        selectedAccessories.includes(acc.name) && "border-primary bg-primary/5"
                      )}
                    >
                      <Checkbox
                        checked={selectedAccessories.includes(acc.name)}
                        onCheckedChange={(checked) =>
                          handleAccessoryToggle(acc.name, checked === true)
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{acc.name}</p>
                        <p className="text-xs text-muted-foreground">{acc.category}</p>
                      </div>
                      <span className="text-sm font-medium shrink-0">{formatCurrency(acc.contractorPrice)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" className="flex-1" disabled={isCalculating}>
                  {isCalculating ? (
                    <span className="flex items-center gap-2">
                      <div className="size-4 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" />
                      Calculating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Calculator className="size-4" />
                      Calculate Estimate
                    </span>
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={handleReset}>
                  <RotateCcw className="size-4" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <AnimatePresence mode="wait">
          {result ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="size-5" />
                    Estimate Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Contractor Cost</span>
                      <span className="text-lg font-semibold">{formatCurrency(result.totalContractorCost)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Company Profit</span>
                      <span className="text-lg font-semibold text-blue-600">{formatCurrency(result.companyProfit)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Customer Price</span>
                      <span className="text-2xl font-bold text-primary">{formatCurrency(result.customerPrice)}</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Breakdown</p>
                    {result.breakdownItems.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm py-1">
                        <span className="text-muted-foreground truncate mr-2">{item.description}</span>
                        <span className="font-medium shrink-0">{formatCurrency(item.totalPrice)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full min-h-[300px] text-center text-muted-foreground"
            >
              <Calculator className="size-12 mb-4 opacity-30" />
              <p className="font-medium">Ready to calculate</p>
              <p className="text-sm">Enter dimensions and options to get an estimate</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
