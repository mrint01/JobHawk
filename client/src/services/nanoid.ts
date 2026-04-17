/** Tiny nano-id replacement (no dependency needed) */
export function nanoid(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: size }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join('')
}
