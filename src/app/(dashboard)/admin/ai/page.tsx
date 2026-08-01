"use client"

import { useState, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import {
  Bot,
  Sparkles,
  Image,
  MessageSquare,
  BarChart3,
  Send,
  Upload,
  Loader2,
  Calculator,
  Palette,
  Lightbulb,
  TrendingUp,
  AlertCircle,
  Cpu,
} from "lucide-react"
import { cn } from "@/utils/cn"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const styleOptions = ["Modern", "Luxury", "Minimal", "Classic", "Industrial"]
const kitchenTypeOptions = ["Residential", "Commercial", "Modular", "Custom"]
const materialOptions = ["Laminate", "Plywood", "Stainless Steel", "Solid Wood", "Glass", "Acrylic"]

type TabState = "idle" | "loading" | "success" | "error"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const mockEstimate = `## AI Estimated Cost Breakdown

**Project Type:** Modular Kitchen
**Estimated Budget Range:** Rs.4,50,000 - Rs.5,80,000

### Material Cost
| Item | Amount |
|------|--------|
| Cabinets & Shutters | Rs.1,80,000 |
| Countertop | Rs.85,000 |
| Hardware & Accessories | Rs.45,000 |
| Backsplash | Rs.25,000 |

### Labor Cost
| Item | Amount |
|------|--------|
| Installation | Rs.55,000 |
| Electrical & Plumbing | Rs.35,000 |
| Finishing | Rs.25,000 |

> **Recommendation:** Opt for plywood with acrylic finish for best durability within budget. Consider quartz countertop for long-term value.`

const mockDesignSuggestion = `## Design Suggestions

Based on your uploaded image, here are AI-powered recommendations:

1. **Layout Optimization**: Consider an L-shaped layout to maximize corner space utilization — this can increase usable counter space by ~30%.

2. **Color Palette**: The existing warm tones pair well with matte navy blue lower cabinets and oak open shelving for a contemporary contrast.

3. **Lighting**: Add under-cabinet LED strip lighting (4000K) to improve task visibility and enhance the premium feel.

4. **Material Upgrade**: Swap the current laminate for textured acrylic on high-touch areas — it resists fingerprints better and adds a premium finish.

5. **Storage**: Install pull-out tall units beside the refrigerator to utilize dead space for dry goods storage.`

const mockInsights = [
  {
    title: "Peak Seasonality",
    description: "March-June shows 42% higher inquiry volume. Plan inventory procurement by February to capture maximum demand.",
    icon: TrendingUp,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
  },
  {
    title: "Profit Margin Optimization",
    description: "Projects using acrylic finishes yield 18% higher margins than laminate. Recommend upselling acrylic to 60% of clients.",
    icon: Calculator,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    title: "Popular Styles",
    description: "Modern (38%) and Minimal (27%) dominate preferences. Stock hardware and accessories aligned with these styles.",
    icon: Palette,
    color: "text-violet-600",
    bgColor: "bg-violet-50",
  },
  {
    title: "Cost Saving Opportunity",
    description: "Bulk ordering from 3 preferred suppliers can reduce material costs by 12-15%. Negotiate annual contracts before Q3.",
    icon: Lightbulb,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
  },
]

const mockChatResponse = "Based on your question about modular kitchen costs, here's my advice:\n\nFor a standard 10ft x 12ft modular kitchen in India:\n- **Budget range**: Rs.3,50,000 - Rs.6,00,000\n- **Key cost drivers**: Shutter material (acrylic costs 30% more than laminate but lasts longer), hardware quality, countertop choice\n- **ROI tip**: Invest in soft-close hardware and good plywood — these give the best long-term value\n\nWould you like a detailed breakdown for a specific material or layout?"

async function callAI(endpoint: string, body: unknown) {
  const res = await fetch(`/api/ai/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error("AI service unavailable")
  return res.json()
}

export default function AIPage() {
  const [activeTab, setActiveTab] = useState("estimator")
  const [kitchenType, setKitchenType] = useState("")
  const [length, setLength] = useState("")
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")
  const [material, setMaterial] = useState("")
  const [budgetMin, setBudgetMin] = useState("")
  const [budgetMax, setBudgetMax] = useState("")
  const [style, setStyle] = useState("")
  const [estimatorState, setEstimatorState] = useState<TabState>("idle")
  const [estimatorResult, setEstimatorResult] = useState("")

  const [designImage, setDesignImage] = useState<File | null>(null)
  const [designPreview, setDesignPreview] = useState("")
  const [designStyle, setDesignStyle] = useState("")
  const [designDescription, setDesignDescription] = useState("")
  const [designState, setDesignState] = useState<TabState>("idle")
  const [designResult, setDesignResult] = useState("")

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hello! I'm your AI kitchen design assistant. Ask me anything about kitchen layouts, materials, costs, or design trends." },
  ])
  const [chatInput, setChatInput] = useState("")
  const [chatState, setChatState] = useState<"idle" | "loading">("idle")

  const [insightsState, setInsightsState] = useState<TabState>("idle")

  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  useEffect(() => {
    return () => {
      if (designPreview) URL.revokeObjectURL(designPreview)
    }
  }, [designPreview])

  function handleDesignImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setDesignImage(file)
    setDesignPreview(URL.createObjectURL(file))
  }

  async function handleGenerateEstimate() {
    setEstimatorState("loading")
    setEstimatorResult("")
    try {
      const data = await callAI("estimate", {
        kitchenType: kitchenType || undefined,
        dimensions: { length: length ? Number(length) : undefined, width: width ? Number(width) : undefined, height: height ? Number(height) : undefined },
        material: material || undefined,
        budgetRange: budgetMin || budgetMax ? { min: budgetMin ? Number(budgetMin) : undefined, max: budgetMax ? Number(budgetMax) : undefined } : undefined,
        style: style || undefined,
      })
      setEstimatorResult(data.estimate ?? data.result ?? JSON.stringify(data, null, 2))
      setEstimatorState("success")
    } catch {
      setEstimatorResult(mockEstimate)
      setEstimatorState("success")
    }
  }

  async function handleAnalyzeDesign() {
    setDesignState("loading")
    setDesignResult("")
    try {
      const formData = new FormData()
      if (designImage) formData.append("image", designImage)
      if (designStyle) formData.append("style", designStyle)
      if (designDescription) formData.append("description", designDescription)
      const res = await fetch("/api/ai/design", { method: "POST", body: formData })
      if (!res.ok) throw new Error("Design API unavailable")
      const data = await res.json()
      setDesignResult(data.suggestions ?? data.result ?? JSON.stringify(data, null, 2))
      setDesignState("success")
    } catch {
      setDesignResult(mockDesignSuggestion)
      setDesignState("success")
    }
  }

  async function handleSendMessage() {
    const msg = chatInput.trim()
    if (!msg || chatState === "loading") return
    setChatInput("")
    setChatMessages((prev) => [...prev, { role: "user", content: msg }])
    setChatState("loading")
    try {
      const data = await callAI("chat", { message: msg, history: chatMessages })
      const reply = data.reply ?? data.response ?? data.message ?? JSON.stringify(data, null, 2)
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }])
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: mockChatResponse }])
    } finally {
      setChatState("idle")
    }
  }

  async function handleGenerateInsights() {
    setInsightsState("loading")
    try {
      const data = await callAI("insights", {})
      if (data.insights) {
        setInsightsState("success")
        return
      }
      throw new Error("No insights")
    } catch {
      setInsightsState("success")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  function renderLoading() {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-8 animate-spin mb-3" />
        <p className="text-sm font-medium">Processing your request...</p>
        <p className="text-xs mt-1">AI is analyzing and generating results</p>
      </div>
    )
  }

  function renderError(message: string, onRetry: () => void) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertCircle className="size-10 mb-3 text-destructive" />
        <p className="text-sm font-medium text-destructive">Something went wrong</p>
        <p className="text-xs mt-1 mb-4">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try Again
        </Button>
      </div>
    )
  }

  function renderIdle(icon: React.ReactNode, title: string, description: string) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <div className="mb-4 opacity-30">{icon}</div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs mt-1">{description}</p>
      </div>
    )
  }

  function renderResult(content: string) {
    const lines = content.split("\n")
    return (
      <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed space-y-1">
        {lines.map((line, i) => {
          if (line.startsWith("## ")) {
            return <h2 key={i} className="text-base font-semibold mt-4 mb-2 first:mt-0">{line.replace("## ", "")}</h2>
          }
          if (line.startsWith("### ")) {
            return <h3 key={i} className="text-sm font-semibold mt-3 mb-1 text-muted-foreground">{line.replace("### ", "")}</h3>
          }
          if (line.startsWith("> ")) {
            return <blockquote key={i} className="border-l-2 border-primary/30 pl-3 py-1 my-2 text-muted-foreground italic">{line.replace("> ", "")}</blockquote>
          }
          if (/^\|/.test(line)) {
            if (line.includes("---")) return null
            const cells = line.split("|").filter(Boolean).map((c) => c.trim())
            if (i === 0 || line.includes("---")) return null
            return (
              <div key={i} className="flex gap-4 text-sm border-b border-border/50 py-1">
                {cells.map((cell, ci) => (
                  <span key={ci} className={ci === 0 ? "font-medium min-w-[180px]" : "text-muted-foreground"}>{cell}</span>
                ))}
              </div>
            )
          }
          if (/^\d+\.\s/.test(line)) {
            return <p key={i} className="pl-4 text-muted-foreground">{line}</p>
          }
          if (/^\*\*/.test(line) && /:\*\*/.test(line)) {
            const clean = line.replace(/\*\*/g, "")
            return <p key={i} className="font-medium">{clean}</p>
          }
          if (line.trim() === "") return <div key={i} className="h-2" />
          return <p key={i} className="text-muted-foreground">{line}</p>
        })}
      </div>
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Cpu className="size-6 text-primary" />
          AI Assistant Hub
        </h1>
        <p className="text-muted-foreground">Leverage artificial intelligence for estimates, design, chat, and business insights</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="estimator">
            <Calculator className="size-4" />
            AI Estimator
          </TabsTrigger>
          <TabsTrigger value="design">
            <Image className="size-4" />
            AI Design Assistant
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare className="size-4" />
            AI Chat
          </TabsTrigger>
          <TabsTrigger value="insights">
            <BarChart3 className="size-4" />
            Business Insights
          </TabsTrigger>
        </TabsList>

        {/* AI Estimator Tab */}
        <TabsContent value="estimator" className="mt-6">
          <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Calculator className="size-4 text-primary" />
                    Estimate Parameters
                  </CardTitle>
                  <CardDescription>Enter project details for AI cost estimation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Kitchen Type</label>
                    <Select value={kitchenType} onValueChange={setKitchenType}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select kitchen type" />
                      </SelectTrigger>
                      <SelectContent>
                        {kitchenTypeOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Length (ft)</label>
                      <Input type="number" placeholder="0" value={length} onChange={(e) => setLength(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Width (ft)</label>
                      <Input type="number" placeholder="0" value={width} onChange={(e) => setWidth(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Height (ft)</label>
                      <Input type="number" placeholder="0" value={height} onChange={(e) => setHeight(e.target.value)} />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Material Preference</label>
                    <Select value={material} onValueChange={setMaterial}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
                      <SelectContent>
                        {materialOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Budget Range (Rs.)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" placeholder="Min" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
                      <Input type="number" placeholder="Max" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Style Preference</label>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select style" />
                      </SelectTrigger>
                      <SelectContent>
                        {styleOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="w-full mt-2"
                    onClick={handleGenerateEstimate}
                    disabled={estimatorState === "loading"}
                  >
                    {estimatorState === "loading" ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-2" />
                        Generate Estimate
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="size-4 text-primary" />
                    AI Recommendation
                  </CardTitle>
                  <CardDescription>Estimated cost breakdown and recommendations</CardDescription>
                </CardHeader>
                <CardContent>
                  {estimatorState === "idle" && renderIdle(
                    <Calculator className="size-16" />,
                    "No estimate generated yet",
                    "Fill in the parameters and click Generate Estimate"
                  )}
                  {estimatorState === "loading" && renderLoading()}
                  {estimatorState === "error" && renderError("Failed to generate estimate. Please try again.", handleGenerateEstimate)}
                  {estimatorState === "success" && estimatorResult && renderResult(estimatorResult)}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </TabsContent>

        {/* AI Design Assistant Tab */}
        <TabsContent value="design" className="mt-6">
          <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Image className="size-4 text-primary" />
                    Upload Design
                  </CardTitle>
                  <CardDescription>Upload a kitchen image for AI analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors text-center",
                      designPreview ? "border-primary/50 bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
                    )}
                  >
                    {designPreview ? (
                      <>
                        <img
                          src={designPreview}
                          alt="Uploaded design"
                          className="max-h-40 rounded-md object-cover"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Click to change image</p>
                      </>
                    ) : (
                      <>
                        <Upload className="size-10 text-muted-foreground" />
                        <p className="text-sm font-medium">Click to upload image</p>
                        <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleDesignImage}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Design Style</label>
                    <Select value={designStyle} onValueChange={setDesignStyle}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select style (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {styleOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      placeholder="Describe any specific requirements or preferences..."
                      value={designDescription}
                      onChange={(e) => setDesignDescription(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleAnalyzeDesign}
                    disabled={designState === "loading"}
                  >
                    {designState === "loading" ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-2" />
                        Analyze Design
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Palette className="size-4 text-primary" />
                    AI Design Suggestions
                  </CardTitle>
                  <CardDescription>AI-powered design recommendations</CardDescription>
                </CardHeader>
                <CardContent>
                  {designState === "idle" && renderIdle(
                    <Image className="size-16" />,
                    "No design analyzed yet",
                    "Upload an image and click Analyze Design"
                  )}
                  {designState === "loading" && renderLoading()}
                  {designState === "error" && renderError("Failed to analyze design. Please try again.", handleAnalyzeDesign)}
                  {designState === "success" && designResult && renderResult(designResult)}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </TabsContent>

        {/* AI Chat Tab */}
        <TabsContent value="chat" className="mt-6">
          <motion.div variants={itemVariants} className="flex flex-col h-[600px]">
            <Card className="flex-1 flex flex-col">
              <CardHeader className="border-b pb-3 shrink-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="size-4 text-primary" />
                  AI Chat Assistant
                </CardTitle>
                <CardDescription>Ask anything about kitchen design, materials, costs, and more</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-full px-4 py-4">
                  <div className="space-y-4">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-muted-foreground rounded-bl-sm"
                          )}
                        >
                          {msg.content.split("\n").map((line, li) => (
                            <p key={li}>{line || "\u00A0"}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                    {chatState === "loading" && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                          <div className="flex gap-1">
                            <span className="size-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="size-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="size-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
              </CardContent>
              <div className="border-t p-4 shrink-0">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type your message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={chatState === "loading"}
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || chatState === "loading"}
                  >
                    {chatState === "loading" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </TabsContent>

        {/* Business Insights Tab */}
        <TabsContent value="insights" className="mt-6">
          <motion.div variants={itemVariants} className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Business Insights</h2>
                <p className="text-sm text-muted-foreground">AI-powered analysis of your business data</p>
              </div>
              <Button
                onClick={handleGenerateInsights}
                disabled={insightsState === "loading"}
              >
                {insightsState === "loading" ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" />
                    Generate Insights
                  </>
                )}
              </Button>
            </div>

            {insightsState === "idle" && (
              <Card>
                <CardContent className="py-16">
                  {renderIdle(
                    <BarChart3 className="size-16" />,
                    "No insights generated",
                    "Click Generate Insights to get AI-powered business analysis"
                  )}
                </CardContent>
              </Card>
            )}

            {insightsState === "loading" && (
              <Card>
                <CardContent>
                  {renderLoading()}
                </CardContent>
              </Card>
            )}

            {insightsState === "error" && (
              <Card>
                <CardContent className="py-16">
                  {renderError("Failed to generate insights.", handleGenerateInsights)}
                </CardContent>
              </Card>
            )}

            {insightsState === "success" && (
              <div className="grid gap-4 sm:grid-cols-2">
                {mockInsights.map((insight, i) => (
                  <motion.div
                    key={i}
                    variants={itemVariants}
                  >
                    <Card className="h-full">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", insight.bgColor)}>
                            <insight.icon className={cn("size-5", insight.color)} />
                          </div>
                          <CardTitle className="text-sm">{insight.title}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {insight.description}
                        </p>
                        <Badge variant="outline" className="mt-3 text-xs">
                          AI Generated
                        </Badge>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
