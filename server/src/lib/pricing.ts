/** Map Prompt Hub quality values to OpenAI-compatible image quality values. */
export function mapQualityForGptImage(quality: string): string {
  const q = String(quality || '').trim().toLowerCase();
  if (q === 'high' || q === 'ultra') return 'high';
  if (q === 'low') return 'low';
  if (q === 'medium' || q === 'standard') return 'medium';
  return 'auto';
}

/** Legacy Apimart Seedream request mapping, retained for old queued task submission. */
export function mapResolutionForSeedream(resolution: string): string {
  const map: Record<string, string> = { '1k': '2K', '2k': '2K', '4k': '4K' };
  return map[resolution] ?? '2K';
}
