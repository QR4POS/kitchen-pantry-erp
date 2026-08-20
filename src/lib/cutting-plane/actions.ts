// ============================================================
// CUTTING PLANE MODULE — SERVER ACTIONS
// ============================================================
// Admin/contractor-facing actions. Isolated from WhatsApp and
// existing AI systems.

'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ProjectRow, CustomerRow } from '@/types/database'
import {
  generateCuttingPlanPDFBuffer,
  generateCuttingPlan,
} from './generator'
import { uploadCuttingPlanPDF, downloadCuttingPlanPDF, getCuttingPlanSignedUrl } from './storage'

export interface CuttingPlanRecord {
  id: string
  project_id: string
  version: number
  storage_path: string
  file_name: string
  status: string
  generated_at: string
  generated_by?: string
  design_hash: string
  metadata: Record<string, unknown>
}

interface ProjectWithCustomer extends ProjectRow {
  customers: CustomerRow | null
}

export async function getProjectForCuttingPlan(projectId: string): Promise<{
  project: ProjectWithCustomer | null
  measurement: { length: number; width: number; height: number; kitchen_type: string } | null
}> {
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*, customers(*)')
    .eq('id', projectId)
    .single()

  const { data: measurement } = await supabase
    .from('project_measurements')
    .select('length, width, height, kitchen_type')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return {
    project: project as unknown as ProjectWithCustomer | null,
    measurement: measurement as unknown as {
      length: number
      width: number
      height: number
      kitchen_type: string
    } | null,
  }
}

export async function generateAndSaveCuttingPlan(projectId: string): Promise<{
  success: boolean
  record?: CuttingPlanRecord
  error?: string
}> {
  try {
    const supabase = await createServerSupabaseClient()
    const admin = createAdminClient()

    // Auth check: admin or staff only
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = (profile as unknown as { role: string } | null)?.role
    if (role !== 'admin' && role !== 'staff') {
      return { success: false, error: 'Only admin or staff can generate cutting plans' }
    }

    const { project, measurement } = await getProjectForCuttingPlan(projectId)
    if (!project) return { success: false, error: 'Project not found' }

    const length = Number(measurement?.length ?? project.length ?? 0)
    const width = Number(measurement?.width ?? project.width ?? 0)
    const height = Number(measurement?.height ?? project.height ?? 0)
    if (length <= 0 || width <= 0 || height <= 0) {
      return { success: false, error: 'Invalid project dimensions' }
    }

    const kitchenType = measurement?.kitchen_type ?? project.kitchen_type ?? 'straight'
    const material = project.material_type ?? 'MDF'
    const customerName = project.customers?.full_name ?? undefined

    // Determine next version
    const { data: existing } = await admin
      .from('cutting_plan_documents')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = ((existing as unknown as { version: number } | null)?.version ?? 0) + 1

    const { buffer, document } = await generateCuttingPlanPDFBuffer({
      project: {
        projectId,
        projectName: project.project_name,
        customerName,
        kitchenType,
        material,
        finish: 'Standard',
      },
      length,
      width,
      height,
    })

    const fileName = `cutting-plan-v${nextVersion}.pdf`
    const { path: storagePath } = await uploadCuttingPlanPDF(projectId, nextVersion, buffer)

    const { data: record, error: insertError } = await admin
      .from('cutting_plan_documents')
      .insert({
        project_id: projectId,
        version: nextVersion,
        storage_path: storagePath,
        file_name: fileName,
        status: 'generated',
        generated_at: new Date().toISOString(),
        generated_by: user.id,
        design_hash: document.designHash,
        metadata: {
          panelCount: document.totalPanels,
          uniquePanelCount: document.totalUniquePanels,
          pageCount: document.pageCount,
          generatedAt: document.generatedAt,
        },
      })
      .select()
      .single()

    if (insertError) throw insertError

    return { success: true, record: record as unknown as CuttingPlanRecord }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

export async function getCuttingPlansForProject(projectId: string): Promise<{
  success: boolean
  plans?: CuttingPlanRecord[]
  latestIsCurrent?: boolean
  currentDesignHash?: string
  error?: string
}> {
  try {
    const supabase = await createServerSupabaseClient()
    const admin = createAdminClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = (profile as unknown as { role: string } | null)?.role

    // Contractors may only view plans for their assigned projects
    if (role === 'contractor') {
      const { data: contractor } = await supabase
        .from('contractors')
        .select('id')
        .eq('user_id', user.id)
        .single()
      const contractorId = (contractor as unknown as { id: string } | null)?.id
      const { data: project } = await supabase
        .from('projects')
        .select('contractor_id')
        .eq('id', projectId)
        .single()
      if ((project as unknown as { contractor_id: string | null } | null)?.contractor_id !== contractorId) {
        return { success: false, error: 'Not assigned to this project' }
      }
    }

    const { data, error } = await admin
      .from('cutting_plan_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })

    if (error) throw error

    const plans = (data ?? []) as unknown as CuttingPlanRecord[]

    // Compute current design hash for outdated check
    const { project, measurement } = await getProjectForCuttingPlan(projectId)
    let currentDesignHash: string | undefined
    let latestIsCurrent = true
    if (project && measurement) {
      const document = generateCuttingPlan({
        project: {
          projectId,
          projectName: project.project_name,
          customerName: project.customers?.full_name ?? undefined,
          kitchenType: measurement.kitchen_type ?? project.kitchen_type ?? 'straight',
          material: project.material_type ?? 'MDF',
          finish: 'Standard',
        },
        length: Number(measurement.length),
        width: Number(measurement.width),
        height: Number(measurement.height),
      })
      currentDesignHash = document.designHash
      const latest = plans[0]
      latestIsCurrent = !latest || latest.design_hash === currentDesignHash
    }

    return { success: true, plans, latestIsCurrent, currentDesignHash }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

export async function getCuttingPlanDownloadUrl(
  projectId: string,
  planId: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const supabase = await createServerSupabaseClient()
    const admin = createAdminClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = (profile as unknown as { role: string } | null)?.role

    if (role === 'contractor') {
      const { data: contractor } = await supabase
        .from('contractors')
        .select('id')
        .eq('user_id', user.id)
        .single()
      const contractorId = (contractor as unknown as { id: string } | null)?.id
      const { data: project } = await supabase
        .from('projects')
        .select('contractor_id')
        .eq('id', projectId)
        .single()
      if ((project as unknown as { contractor_id: string | null } | null)?.contractor_id !== contractorId) {
        return { success: false, error: 'Not assigned to this project' }
      }
    }

    const { data, error } = await admin
      .from('cutting_plan_documents')
      .select('storage_path')
      .eq('id', planId)
      .eq('project_id', projectId)
      .single()

    if (error || !data) return { success: false, error: 'Plan not found' }

    const path = (data as unknown as { storage_path: string }).storage_path
    const url = await getCuttingPlanSignedUrl(path, 600)
    return { success: true, url }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

export async function getCuttingPlanPDF(projectId: string, planId: string): Promise<{
  success: boolean
  buffer?: Buffer
  fileName?: string
  error?: string
}> {
  try {
    const supabase = await createServerSupabaseClient()
    const admin = createAdminClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = (profile as unknown as { role: string } | null)?.role

    if (role === 'contractor') {
      const { data: contractor } = await supabase
        .from('contractors')
        .select('id')
        .eq('user_id', user.id)
        .single()
      const contractorId = (contractor as unknown as { id: string } | null)?.id
      const { data: project } = await supabase
        .from('projects')
        .select('contractor_id')
        .eq('id', projectId)
        .single()
      if ((project as unknown as { contractor_id: string | null } | null)?.contractor_id !== contractorId) {
        return { success: false, error: 'Not assigned to this project' }
      }
    }

    const { data, error } = await admin
      .from('cutting_plan_documents')
      .select('storage_path, file_name')
      .eq('id', planId)
      .eq('project_id', projectId)
      .single()

    if (error || !data) return { success: false, error: 'Plan not found' }

    const row = data as unknown as { storage_path: string; file_name: string }
    const buffer = await downloadCuttingPlanPDF(row.storage_path)
    return { success: true, buffer, fileName: row.file_name }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}
