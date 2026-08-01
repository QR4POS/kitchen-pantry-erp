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

    const body = await request.json()
    const { kitchen_type, length, width, height, material_preference, budget, style } = body

    if (!kitchen_type || !length || !width || !height) {
      return NextResponse.json({ error: "Missing required fields: kitchen_type, length, width, height" }, { status: 400 })
    }

    const systemPrompt = `You are a professional kitchen cost estimation expert for Kitchen Pantry ERP. 
Provide a detailed cost estimate for a kitchen with the following specifications:
- Type: ${kitchen_type}
- Dimensions: ${length}ft x ${width}ft x ${height}ft
- Material Preference: ${material_preference || "Not specified"}
- Budget: ${budget || "Not specified"}
- Style: ${style || "Not specified"}

Include breakdown for materials, labor, hardware, accessories, and total estimated cost. Give a realistic range.`
    const userPrompt = `Please generate a detailed kitchen cost estimate for a ${kitchen_type} kitchen with dimensions ${length}x${width}x${height} feet.`

    const result = await callAI([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])

    const { error: dbError } = await supabase
      .from("ai_requests")
      .insert({
        user_id: user.id,
        request_type: "estimate",
        request_body: body,
        response_body: result,
        created_at: new Date().toISOString(),
      })

    if (dbError) {
      console.error("Failed to log AI request:", dbError)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("AI estimate error:", error)
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
