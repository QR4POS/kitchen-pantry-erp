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
    const { image_url, analysis_type } = body

    if (!image_url || !analysis_type) {
      return NextResponse.json({ error: "Missing required fields: image_url, analysis_type" }, { status: 400 })
    }

    if (!["room", "drawing", "measurements"].includes(analysis_type)) {
      return NextResponse.json({ error: "Invalid analysis_type. Must be: room, drawing, or measurements" }, { status: 400 })
    }

    let analysisFocus: string
    switch (analysis_type) {
      case "room":
        analysisFocus = "Analyze the room layout, dimensions, lighting conditions, existing fixtures, and suggest optimal kitchen placement."
        break
      case "drawing":
        analysisFocus = "Analyze the architectural drawing, identify dimensions, structural elements, plumbing points, electrical outlets, and ventilation."
        break
      case "measurements":
        analysisFocus = "Extract and verify measurements from the image, check proportions, identify any measurement inconsistencies, and suggest corrections."
        break
      default:
        analysisFocus = "Analyze the kitchen image and provide detailed observations about layout, space, and design possibilities."
        break
    }

    const systemPrompt = `You are a kitchen image analysis expert for Kitchen Pantry ERP.
${analysisFocus}

Image URL: ${image_url}
Analysis Type: ${analysis_type}

Provide detailed analysis with actionable insights.`

    const userPrompt = `Please analyze this ${analysis_type} image at ${image_url} for kitchen planning purposes.`

    const result = await callAI([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])

    return NextResponse.json({
      analysis_type,
      image_url,
      result,
    })
  } catch (error) {
    console.error("AI image analysis error:", error)
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
