// ============================================================
// API: /api/cutting-plans/[id]
// ============================================================
// GET: download a specific cutting-plan PDF

import { NextRequest, NextResponse } from 'next/server'
import { getCuttingPlanPDF } from '@/lib/cutting-plane/actions'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const { id: planId } = await params
    const result = await getCuttingPlanPDF(projectId, planId)
    if (!result.success || !result.buffer) {
      return NextResponse.json({ error: result.error ?? 'Download failed' }, { status: 400 })
    }

    return new NextResponse(new Blob([new Uint8Array(result.buffer)]), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.fileName ?? 'cutting-plan.pdf'}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
