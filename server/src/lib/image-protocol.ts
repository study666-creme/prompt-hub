export const IMAGE_PROTOCOL_VERSION = 'image.v1' as const;

export type ImageProtocolOperation = 'text_to_image' | 'image_to_image' | 'image_edit';
export type ImageProtocolRole = 'reference' | 'style_reference' | 'element_reference' | 'mask';

export type ImageProtocolInput = {
  kind: 'image';
  role: ImageProtocolRole;
  url: string;
};

export type ImageProtocolRequest = {
  version: typeof IMAGE_PROTOCOL_VERSION;
  model: string;
  operation: ImageProtocolOperation;
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
  quality?: string;
  count?: number;
  media_inputs?: ImageProtocolInput[];
  options?: Record<string, unknown>;
};

export function buildImageProtocolRequest(input: {
  model: string;
  prompt: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  count?: number;
  mediaInputs?: ImageProtocolInput[];
  options?: Record<string, unknown>;
}): ImageProtocolRequest {
  const mediaInputs = input.mediaInputs || [];
  const operation: ImageProtocolOperation = mediaInputs.some((item) => item.role === 'mask')
    ? 'image_edit'
    : mediaInputs.length
      ? 'image_to_image'
      : 'text_to_image';
  return {
    version: IMAGE_PROTOCOL_VERSION,
    model: input.model.trim(),
    operation,
    prompt: input.prompt.trim(),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
    ...(mediaInputs.length ? { media_inputs: mediaInputs } : {}),
    options: { ...(input.options || {}) }
  };
}
