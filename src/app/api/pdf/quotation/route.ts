import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { generateQuotationPDF } from "@/lib/pdf/quotation"

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

    if (!profile) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 })
    }

    const body = await request.json()
    const { quotationId, projectId, estimateId } = body

    if (!quotationId || !projectId || !estimateId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data: quotation } = await supabase
      .from("quotations")
      .select("*")
      .eq("id", quotationId)
      .single()

    if (!quotation) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    const { data: project } = await supabase
      .from("projects")
      .select("*, customers(*)")
      .eq("id", projectId)
      .single()

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { data: estimate } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .single()

    if (!estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 })
    }

    const customer = project.customers as Record<string, unknown> | undefined

    const pdfBuffer = await generateQuotationPDF({
      quotationNumber: quotation.quotation_number,
      date: new Date(quotation.created_at).toLocaleDateString("en-IN"),
      validUntil: quotation.valid_until
        ? new Date(quotation.valid_until).toLocaleDateString("en-IN")
        : "N/A",

      companyName: "Kitchen Pantry",
      companyAddress: "123, Industrial Area",
      companyCity: "Mumbai, Maharashtra",
      companyPhone: "+91 98765 43210",
      companyEmail: "info@kitchenpantry.com",

      customerName: (customer?.full_name as string) || (customer?.company as string) || (customer?.email as string) || "Valued Customer",
      customerAddress: (customer?.address as string) || "",
      customerCity: (customer?.city as string) || "",
      customerPhone: (customer?.phone as string) || "",
      customerEmail: (customer?.email as string) || "",

      kitchenType: project.kitchen_type,
      material: project.material_type,
      dimensions: {
        length: project.length,
        width: project.width,
        height: project.height,
      },

      items: [
        { description: "Materials", quantity: 1, unitPrice: estimate.materials_cost, total: estimate.materials_cost },
        { description: "Labor", quantity: 1, unitPrice: estimate.labor_cost, total: estimate.labor_cost },
        { description: "Accessories & Hardware", quantity: 1, unitPrice: estimate.accessories_cost, total: estimate.accessories_cost },
      ],
      subtotal: estimate.total_cost,
      tax: 0,
      total: quotation.customer_price,

      warrantyYears: quotation.warranty_years ?? 5,
      terms: quotation.terms || "50% advance required. Remaining 50% before installation.",
      paymentTerms: "50% Advance, 50% Before Installation",
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Quotation-${quotation.quotation_number}.pdf"`,
      },
    })
  } catch (error) {
    console.error("PDF generation error:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}
