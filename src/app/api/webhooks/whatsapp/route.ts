import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const entry = body?.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value

    const messages = value?.messages
    const metadata = value?.metadata

    if (messages) {
      for (const msg of messages) {
        const from = msg.from
        const msgType = msg.type
        const text = msg.text?.body || ""

        console.log({
          from,
          type: msgType,
          body: text,
          phoneNumberId: metadata?.phone_number_id,
          displayPhoneNumber: metadata?.display_phone_number,
        })
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 200 })
  } catch (error) {
    console.error("WhatsApp webhook error:", error)
    return NextResponse.json({ status: "ok" }, { status: 200 })
  }
}
