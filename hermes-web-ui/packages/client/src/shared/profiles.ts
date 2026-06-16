const PROFILE_ALIASES: Record<string, string> = {
  herbound: 'default',
}

export function normalizeProfileName(profile?: string | null): string {
  const value = (profile || 'default').trim() || 'default'
  return PROFILE_ALIASES[value] || value
}

export function normalizeProfileFilter(profile?: string | null): string | null {
  if (!profile || profile === '__all__') return null
  return normalizeProfileName(profile)
}
