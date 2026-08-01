"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import {
  Building2,
  FileText,
  Bell,
  Settings,
  Upload,
  Eye,
  Save,
  Download,
  Check,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/utils/cn"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const notificationsList = [
  { id: "email", label: "Email Notifications" },
  { id: "sms", label: "SMS Notifications" },
  { id: "new_customer", label: "New Customer Alerts" },
  { id: "project_status", label: "Project Status Updates" },
  { id: "payment_reminder", label: "Payment Reminders" },
  { id: "low_stock", label: "Low Stock Alerts" },
] as const

export default function SettingsPage() {
  const [company, setCompany] = useState({
    name: "Kitchen Pantry ERP",
    phone: "+91 98765 43210",
    email: "admin@kitchenpantry.com",
    address: "123, Industrial Layout, Bangalore - 560001",
  })
  const [quotation, setQuotation] = useState({
    terms: "All prices are ex-factory and subject to GST. Delivery timeline starts after advance payment confirmation.",
    warrantyYears: "5",
    validUntilDays: "15",
  })
  const [notifications, setNotifications] = useState({
    email: true,
    sms: false,
    new_customer: true,
    project_status: true,
    payment_reminder: true,
    low_stock: true,
  })
  const [system, setSystem] = useState({
    currency: "LKR",
    taxPercentage: "18",
    dateFormat: "DD/MM/YYYY",
    sessionTimeout: "30",
  })
  const [saving, setSaving] = useState<string | null>(null)

  async function handleSave(section: string) {
    setSaving(section)
    await new Promise((r) => setTimeout(r, 800))
    setSaving(null)
  }

  function toggleNotification(id: keyof typeof notifications) {
    setNotifications((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your application settings</p>
      </div>

      <Tabs defaultValue="company" className="w-full">
        <TabsList>
          <TabsTrigger value="company">
            <Building2 className="size-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="quotation">
            <FileText className="size-4" />
            Quotation Template
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="size-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="system">
            <Settings className="size-4" />
            System
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Company Information</CardTitle>
                <CardDescription>Update your business details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    value={company.name}
                    onChange={(e) => setCompany({ ...company, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="company-phone">Phone</Label>
                  <Input
                    id="company-phone"
                    value={company.phone}
                    onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="company-email">Email</Label>
                  <Input
                    id="company-email"
                    type="email"
                    value={company.email}
                    onChange={(e) => setCompany({ ...company, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="company-address">Address</Label>
                  <textarea
                    id="company-address"
                    className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    value={company.address}
                    onChange={(e) => setCompany({ ...company, address: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Company Logo</Label>
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-muted-foreground/50 transition-colors">
                    <Upload className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click or drag to upload logo</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG up to 2MB</p>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-end">
                  <Button onClick={() => handleSave("company")} disabled={saving === "company"}>
                    <Save className="size-4" />
                    {saving === "company" ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="quotation" className="mt-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Quotation Template</CardTitle>
                <CardDescription>Set default quotation template values</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="terms">Default Terms &amp; Conditions</Label>
                  <textarea
                    id="terms"
                    className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    value={quotation.terms}
                    onChange={(e) => setQuotation({ ...quotation, terms: e.target.value })}
                    rows={4}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="warranty">Warranty (Years)</Label>
                  <Input
                    id="warranty"
                    type="number"
                    value={quotation.warrantyYears}
                    onChange={(e) => setQuotation({ ...quotation, warrantyYears: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="valid-until">Default Valid Until (Days)</Label>
                  <Input
                    id="valid-until"
                    type="number"
                    value={quotation.validUntilDays}
                    onChange={(e) => setQuotation({ ...quotation, validUntilDays: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Signature / Stamp</Label>
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-muted-foreground/50 transition-colors">
                    <Upload className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click or drag to upload signature or stamp</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG up to 2MB</p>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <Button variant="outline">
                    <Eye className="size-4" />
                    Preview
                  </Button>
                  <Button onClick={() => handleSave("quotation")} disabled={saving === "quotation"}>
                    <Save className="size-4" />
                    {saving === "quotation" ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Configure how and when to receive notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {notificationsList.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2">
                    <Label htmlFor={`notif-${item.id}`} className="cursor-pointer">
                      {item.label}
                    </Label>
                    <div className="relative">
                      <Checkbox
                        id={`notif-${item.id}`}
                        checked={notifications[item.id]}
                        onCheckedChange={() => toggleNotification(item.id)}
                        className={cn(
                          "data-[state=checked]:bg-primary data-[state=checked]:border-primary",
                          "peer sr-only"
                        )}
                      />
                      <button
                        type="button"
                        role="switch"
                        aria-checked={notifications[item.id]}
                        aria-labelledby={`notif-${item.id}`}
                        onClick={() => toggleNotification(item.id)}
                        className={cn(
                          "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                          notifications[item.id] ? "bg-primary" : "bg-input"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
                            notifications[item.id] ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-end">
                  <Button onClick={() => handleSave("notifications")} disabled={saving === "notifications"}>
                    <Save className="size-4" />
                    {saving === "notifications" ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="system" className="mt-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>System Settings</CardTitle>
                <CardDescription>Configure global system preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select
                    value={system.currency}
                    onValueChange={(v) => setSystem({ ...system, currency: v })}
                  >
                    <SelectTrigger id="currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LKR">Rs. LKR</SelectItem>
                      <SelectItem value="USD">$ USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tax">Tax Percentage (%)</Label>
                  <Input
                    id="tax"
                    type="number"
                    value={system.taxPercentage}
                    onChange={(e) => setSystem({ ...system, taxPercentage: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="date-format">Date Format</Label>
                  <Select
                    value={system.dateFormat}
                    onValueChange={(v) => setSystem({ ...system, dateFormat: v })}
                  >
                    <SelectTrigger id="date-format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="session-timeout">Session Timeout (Minutes)</Label>
                  <Select
                    value={system.sessionTimeout}
                    onValueChange={(v) => setSystem({ ...system, sessionTimeout: v })}
                  >
                    <SelectTrigger id="session-timeout" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                      <SelectItem value="120">120 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <Button variant="outline">
                    <Download className="size-4" />
                    Backup Data
                  </Button>
                  <Button onClick={() => handleSave("system")} disabled={saving === "system"}>
                    <Save className="size-4" />
                    {saving === "system" ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
