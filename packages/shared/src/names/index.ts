export function normalizeNameStem(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function isValidNameStem(name: string): boolean {
  return normalizeNameStem(name).length > 0
}
