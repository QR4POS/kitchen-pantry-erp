import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { callAI } from "@/lib/ai/provider"

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll() {},
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
    }

    const { data: projects } = await supabase
      .from("projects")
      .select("id, status, total_cost, created_at, kitchen_type, material_type")

    const { data: payments } = await supabase
      .from("payments")
      .select("amount, status, created_at")

    const { data: expenses } = await supabase
      .from("expenses")
      .select("amount, category, created_at")

    const revenue = payments
      ?.filter(p => p.status === "completed")
      .reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

    const totalProjectCost = projects
      ?.reduce((sum, p) => sum + Number(p.total_cost || 0), 0) ?? 0

    const totalExpenses = expenses
      ?.reduce((sum, e) => sum + Number(e.amount), 0) ?? 0

    const profit = revenue - totalExpenses

    const activeProjects = projects?.filter(p => p.status === "active").length ?? 0
    const completedProjects = projects?.filter(p => p.status === "completed").length ?? 0
    const pendingProjects = projects?.filter(p => p.status === "pending").length ?? 0

    const systemPrompt = `You are a business intelligence analyst for Kitchen Pantry ERP.
Analyze the following business data and provide actionable insights:

Business Summary:
- Total Revenue (completed payments): Rs.${revenue.toLocaleString()}
- Total Project Cost (sum of all project costs): Rs.${totalProjectCost.toLocaleString()}
- Total Expenses: Rs.${totalExpenses.toLocaleString()}
- Estimated Profit: Rs.${profit.toLocaleString()}

Project Breakdown:
- Active Projects: ${activeProjects}
- Completed Projects: ${completedProjects}
- Pending Projects: ${pendingProjects}
- Total Projects: ${projects?.length ?? 0}

Project Details: ${JSON.stringify(projects || [])}
Expense Breakdown: ${JSON.stringify(expenses || [])}

Provide insights on:
1. Financial health and profitability
2. Project performance and bottlenecks
3. Cost optimization opportunities
4. Revenue trends and forecasts
5. Strategic recommendations`

    const userPrompt = `Generate a comprehensive business analysis report with actionable insights based on the current data.`

    const result = await callAI([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])

    return NextResponse.json({
      insights: result.content,
      summary: {
        revenue,
        totalProjectCost,
        totalExpenses,
        profit,
        activeProjects,
        completedProjects,
        pendingProjects,
      },
      provider: result.provider,
    })
  } catch (error) {
    console.error("AI business insights error:", error)
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
