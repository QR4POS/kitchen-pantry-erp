// ============================================================
// CUTTING PLAN MODULE — VALIDATION
// ============================================================
// Pre-generation validation (Phase 16). Never generate a misleading
// manufacturing PDF: every failure names the cabinet/part and the
// exact problem so the user can fix the geometry.

import type { CabinetModule, ManufacturingPart, ValidationIssue, ValidationResult } from './types'

export function validateModules(modules: CabinetModule[]): ValidationResult {
  const issues: ValidationIssue[] = []
  const seenIds = new Set<string>()

  if (modules.length === 0) {
    issues.push({ severity: 'error', message: 'No cabinets were derived from the project dimensions. Check that length, width and height are greater than zero.' })
  }

  for (const mod of modules) {
    if (!mod.id) {
      issues.push({ severity: 'error', message: 'A cabinet is missing its ID.' })
      continue
    }
    if (seenIds.has(mod.id)) {
      issues.push({ severity: 'error', cabinetId: mod.id, message: `Duplicate cabinet ID ${mod.id}. Cabinet IDs must be unique.` })
    }
    seenIds.add(mod.id)

    const checks: [string, number][] = [
      ['width', mod.width],
      ['height', mod.height],
      ['depth', mod.depth],
      ['panel thickness', mod.panelThickness],
      ['back panel thickness', mod.backPanelThickness],
    ]
    for (const [label, value] of checks) {
      if (!Number.isFinite(value) || value <= 0) {
        issues.push({
          severity: 'error',
          cabinetId: mod.id,
          message: `${mod.id}: invalid ${label} — ${value} mm.`,
        })
      }
    }
    if (!mod.material) {
      issues.push({ severity: 'error', cabinetId: mod.id, message: `${mod.id}: no material assigned.` })
    }
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues }
}

export function validateParts(parts: ManufacturingPart[]): ValidationResult {
  const issues: ValidationIssue[] = []
  const seenPartIds = new Set<string>()

  if (parts.length === 0) {
    issues.push({ severity: 'error', message: 'The cutting list is empty — no parts could be generated from the cabinet geometry.' })
  }

  for (const part of parts) {
    if (seenPartIds.has(part.partId)) {
      issues.push({ severity: 'error', partId: part.partId, message: `Duplicate Part ID ${part.partId}.` })
    }
    seenPartIds.add(part.partId)

    if (part.width <= 0 || part.height <= 0 || part.thickness <= 0) {
      issues.push({
        severity: 'error',
        partId: part.partId,
        cabinetId: part.cabinetId,
        message: `${part.cabinetId}: ${part.partName} has invalid dimensions ${part.width} × ${part.height} × ${part.thickness} mm.`,
      })
    }
    if (part.quantity <= 0) {
      issues.push({
        severity: 'error',
        partId: part.partId,
        cabinetId: part.cabinetId,
        message: `${part.cabinetId}: ${part.partName} has quantity ${part.quantity} — must be at least 1.`,
      })
    }
    if (!part.material) {
      issues.push({
        severity: 'warning',
        partId: part.partId,
        cabinetId: part.cabinetId,
        message: `${part.cabinetId}: ${part.partName} has no material assigned.`,
      })
    }
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues }
}

/** Formats a failed validation for display in the admin UI. */
export function formatValidationFailure(result: ValidationResult): string {
  const errors = result.issues.filter((i) => i.severity === 'error')
  const lines = errors.slice(0, 5).map((i) => `• ${i.message}`)
  if (errors.length > 5) lines.push(`• …and ${errors.length - 5} more issue(s)`)
  return [
    'Cannot generate Cutting Plan.',
    ...lines,
    '',
    'Please correct the project/cabinet geometry and try again.',
  ].join('\n')
}
