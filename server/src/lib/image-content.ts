export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const MIN_VALID_IMAGE_BYTES = 512;

export function normalizeSupportedImageMime(value: string | null | undefined): SupportedImageMime | null {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/pjpeg') return 'image/jpeg';
  if (mime === 'image/png' || mime === 'image/x-png') return 'image/png';
  if (mime === 'image/webp') return 'image/webp';
  return null;
}

export function sniffImageMime(head: Uint8Array): SupportedImageMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 8
    && head[0] === 0x89
    && head[1] === 0x50
    && head[2] === 0x4e
    && head[3] === 0x47
    && head[4] === 0x0d
    && head[5] === 0x0a
    && head[6] === 0x1a
    && head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    head.length >= 12
    && head[0] === 0x52
    && head[1] === 0x49
    && head[2] === 0x46
    && head[3] === 0x46
    && head[8] === 0x57
    && head[9] === 0x45
    && head[10] === 0x42
    && head[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function validatedImageMime(
  declaredMime: string | null | undefined,
  bytes: Uint8Array,
  totalBytes = bytes.byteLength
): SupportedImageMime | null {
  if (!normalizeSupportedImageMime(declaredMime) || totalBytes < MIN_VALID_IMAGE_BYTES) {
    return null;
  }
  return sniffImageMime(bytes.subarray(0, 16));
}

export async function blobImageMime(blob: Blob | null | undefined): Promise<SupportedImageMime | null> {
  if (!blob || blob.size < MIN_VALID_IMAGE_BYTES) return null;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return sniffImageMime(head);
}
