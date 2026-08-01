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

    const body = await request.json()
    const { message, conversation_id } = body

    if (!message) {
      return NextResponse.json({ error: "Missing required field: message" }, { status: 400 })
    }

    let contextPrompt: string

    switch (profile?.role) {
      case "admin": {
        const { data: businessData } = await supabase
          .from("projects")
          .select("id, status, total_cost, created_at")

        const { data: revenueData } = await supabase
          .from("payments")
          .select("amount, status")

        contextPrompt = `You are a full business assistant for Kitchen Pantry ERP (Admin Context).
Full Business Data Access - Projects: ${JSON.stringify(businessData || [])}
Revenue/Payments: ${JSON.stringify(revenueData || [])}
Conversation ID: ${conversation_id || "new"}

Provide comprehensive business insights, project status updates, and actionable recommendations.`
        break
      }
      case "contractor": {
        const { data: assignedProjects } = await supabase
          .from("projects")
          .select("id, name, status, kitchen_type, dimensions, material_type, start_date, deadline")
          .eq("assigned_contractor_id", user.id)

        contextPrompt = `You are a project assistant for Kitchen Pantry ERP (Contractor Context).
Your Assigned Projects: ${JSON.stringify(assignedProjects || [])}
Conversation ID: ${conversation_id || "new"}

Help with project management, task prioritization, material planning, and installation guidance for your assigned projects only.`
        break
      }
      default: {
        const { data: customerProjects } = await supabase
          .from("projects")
          .select("id, name, status, kitchen_type, length, width, height, material_type, created_at, deadline")
          .eq("customer_id", user.id)

        const { data: estimates } = await supabase
          .from("estimates")
          .select("id, total_cost, materials_cost, labor_cost, status, created_at")
          .eq("customer_id", user.id)

        contextPrompt = `You are a customer support assistant for Kitchen Pantry ERP (Customer Context).
Your Projects: ${JSON.stringify(customerProjects || [])}
Your Estimates: ${JSON.stringify(estimates || [])}
Conversation ID: ${conversation_id || "new"}

Help with project inquiries, estimate clarifications, status updates, and general kitchen planning questions.`
        break
      }
    }

    const result = await callAI([
      { role: "system", content: contextPrompt },
      { role: "user", content: message },
    ])

    const { error: dbError } = await supabase
      .from("ai_requests")
      .insert({
        user_id: user.id,
        request_type: "chat",
        conversation_id: conversation_id || null,
        request_body: { message, conversation_id },
        response_body: result,
        created_at: new Date().toISOString(),
      })

    if (dbError) {
      console.error("Failed to log chat:", dbError)
    }

    return NextResponse.json({
      message: result.content,
      conversation_id: conversation_id || crypto.randomUUID(),
      provider: result.provider,
    })
  } catch (error) {
    console.error("AI chat error:", error)
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
