import type { Env } from '../env';
import { ApiError } from './errors';
import {
  confirmApimartTaskOutcome,
  fetchApimartTaskOnce,
  submitApimartImageJob
} from './apimart';
import {
  confirmGrsaiTaskOutcome,
  fetchGrsaiTaskOnce,
  submitGrsaiImageJob,
  type TaskPollResult
} from './grsai';
import { isGrsaiMaintenanceMessage, noteGrsaiSubmitOutcome } from './grsai-upstream-status';
import { extractErrorMessage } from './cors-headers';
import type { ImageModelProvider } from './image-models-catalog';

export type ImageUpstreamProvider = ImageModelProvider;

export type ImageUpstreamBindings = {
  grsaiKey?: string;
  grsaiBase?: string;
  apimartKey?: string;
  apimartBase?: string;
};

export type ImageSubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

export function upstreamBindingsFromEnv(env: Env): ImageUpstreamBindings {
  return {
    grsaiKey: env.IMAGE_API_KEY,
    grsaiBase: env.IMAGE_API_BASE_URL,
    apimartKey: env.APIMART_API_KEY,
    apimartBase: env.APIMART_API_BASE_URL
  };
}

export function readJobProvider(meta: Record<string, unknown>): ImageUpstreamProvider {
  return meta.provider === 'apimart' ? 'apimart' : 'grsai';
}

export function isProviderConfigured(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider
): boolean {
  return provider === 'apimart' ? !!bindings.apimartKey : !!bindings.grsaiKey;
}

function apimartPollToUnified(result: {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
}): TaskPollResult {
  const status =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'failed' || result.status === 'timeout'
        ? 'failed'
        : 'pending';
  return {
    status,
    imageUrl: result.imageUrl,
    imageUrls: result.imageUrls,
    errorMessage: result.errorMessage,
    isViolation: /violation|违规|moderation|policy/i.test(String(result.errorMessage || ''))
  };
}

export async function fetchUpstreamTaskOnce(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider,
  taskId: string
): Promise<TaskPollResult> {
  if (provider === 'apimart') {
    if (!bindings.apimartKey) {
      return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
    }
    return apimartPollToUnified(
      await fetchApimartTaskOnce(bindings.apimartKey, bindings.apimartBase, taskId)
    );
  }
  if (!bindings.grsaiKey) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  return fetchGrsaiTaskOnce(bindings.grsaiKey, bindings.grsaiBase, taskId);
}

export async function confirmUpstreamTaskOutcome(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<TaskPollResult> {
  if (provider === 'apimart') {
    if (!bindings.apimartKey) {
      return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
    }
    return apimartPollToUnified(
      await confirmApimartTaskOutcome(bindings.apimartKey, bindings.apimartBase, taskId, opts)
    );
  }
  if (!bindings.grsaiKey) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  return confirmGrsaiTaskOutcome(bindings.grsaiKey, bindings.grsaiBase, taskId, opts);
}

/** 按用户所选线路提交（GrsAI / Apimart 为前台独立选项，不做自动切换） */
export async function submitImageJobForProvider(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider,
  params: ImageSubmitParams
): Promise<{ provider: ImageUpstreamProvider; taskId: string }> {
  if (provider === 'apimart') {
    if (!bindings.apimartKey) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Apimart 线路未配置，请联系站长');
    }
    const taskId = await submitApimartImageJob(bindings.apimartKey, bindings.apimartBase, params);
    return { provider: 'apimart', taskId };
  }
  if (!bindings.grsaiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'GrsAI 线路未配置，请联系站长');
  }
  try {
    const taskId = await submitGrsaiImageJob(bindings.grsaiKey, bindings.grsaiBase, {
      upstreamModel: params.upstreamModel,
      prompt: params.prompt,
      resolution: params.resolution,
      size: params.size,
      refImageUrls: params.refImageUrls
    });
    noteGrsaiSubmitOutcome(params.upstreamModel, 'success');
    return { provider: 'grsai', taskId };
  } catch (e) {
    if (isGrsaiMaintenanceMessage(extractErrorMessage(e))) {
      noteGrsaiSubmitOutcome(params.upstreamModel, 'maintenance');
    }
    throw e;
  }
}

export function hasAnyImageUpstream(bindings: ImageUpstreamBindings): boolean {
  return !!(bindings.grsaiKey || bindings.apimartKey);
}
