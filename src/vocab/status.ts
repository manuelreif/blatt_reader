import { STATUS_IGNORED, STATUS_KNOWN } from '../db/schema'

export function statusLabel(status: number): string {
  if (status === STATUS_IGNORED) return 'Ignoriert'
  if (status === STATUS_KNOWN) return 'Bekannt'
  if (status === 1) return 'Neu'
  return `Stufe ${status}`
}

export const STATUS_OPTIONS = [1, 2, 3, 4, 5, STATUS_KNOWN, STATUS_IGNORED]
