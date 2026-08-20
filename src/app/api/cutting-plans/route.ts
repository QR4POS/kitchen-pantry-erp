// ============================================================
// API: /api/cutting-plans
// ============================================================
// POST: generate and save a new cutting plan for a project
// GET:  list cutting plans for a project

import { NextRequest, NextResponse } from 'next/server'
import {
  generateAndSaveCuttingPlan,
  getCuttingPlansForProject,
} from '@/lib/cutting-plane/actions'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId = body.projectId
    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const result = await generateAndSaveCuttingPlan(projectId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, record: result.record })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const result = await getCuttingPlansForProject(projectId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
