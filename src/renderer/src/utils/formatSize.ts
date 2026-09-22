export function formatSize(mb?: number | null): string {
  if (!mb) return '—'
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}
