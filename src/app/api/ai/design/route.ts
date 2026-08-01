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
    const { room_image_url, style, description } = body

    if (!room_image_url || !style) {
      return NextResponse.json({ error: "Missing required fields: room_image_url, style" }, { status: 400 })
    }

    const systemPrompt = `You are a professional kitchen designer for Kitchen Pantry ERP. 
Analyze the room image and provide design suggestions based on:
- Image URL: ${room_image_url}
- Preferred Style: ${style}
- Additional Description: ${description || "Not provided"}

Provide layout recommendations, color schemes, cabinet styles, countertop suggestions, and lighting ideas.`

    const userPrompt = `Design a ${style} style kitchen for the room shown in the image at ${room_image_url}.`

    const result = await callAI([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])

    const { error: dbError } = await supabase
      .from("ai_designs")
      .insert({
        user_id: user.id,
        room_image_url,
        style,
        description,
        design_suggestions: result,
        created_at: new Date().toISOString(),
      })

    if (dbError) {
      console.error("Failed to log AI design:", dbError)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("AI design error:", error)
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
