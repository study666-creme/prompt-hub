import type { Env } from '../env';
import { ApiError } from './errors';
import {
  confirmApimartTaskOutcome,
  fetchApimartTaskOnce,
  submitApimartImageJob
} from './apimart';
import {
  confirmNewApiTaskOutcome,
  fetchNewApiTaskOnce,
  submitNewApiImageJob,
  type NewApiCatalogParameter
} from './newapi';
import {
  confirmGrsaiTaskOutcome,
  fetchGrsaiTaskOnce,
  submitGrsaiImageJob,
  type TaskPollResult
} from './grsai';
import { extractErrorMessage } from './cors-headers';
import {
  submitMidjourneyImagine,
  type SubmitMidjourneyParams
} from './apimart-midjourney';
import { isMidjourneyUpstream } from './midjourney-models';
import type { ImageModelProvider } from './image-models-catalog';

/** 旧 provider 仅用于恢复已经落库的历史任务，不再进入可选模型目录。 */
export type ImageUpstreamProvider = ImageModelProvider | 'grsai' | 'mooko' | 'ithink';

export type ImageUpstreamBindings = {
  grsaiKey?: string;
  grsaiBase?: string;
  apimartKey?: string;
  apimartBase?: string;
  newapiKey?: string;
  newapiBase?: string;
  mookoKey?: string;
  mookoBase?: string;
  ithinkKey?: string;
  ithinkBase?: string;
};

export type ImageSubmitResult = {
  provider: ImageUpstreamProvider;
  taskId: string;
  upstreamRequestId?: string | null;
  /** 同步上游（ThinkAI）提交后直接返回的临时图链 */
  immediateImageUrl?: string | null;
  immediateImageUrls?: string[];
};

export type ImageSubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  fixedQualityLow?: boolean;
  size?: string;
  count?: number;
  refImageUrls?: string[];
  catalogParameters?: NewApiCatalogParameter[];
  mjParams?: Record<string, unknown>;
};

export function upstreamBindingsFromEnv(env: Env): ImageUpstreamBindings {
  return {
    grsaiKey: env.IMAGE_API_KEY,
    grsaiBase: env.IMAGE_API_BASE_URL,
    apimartKey: env.APIMART_API_KEY,
    apimartBase: env.APIMART_API_BASE_URL,
    newapiKey: env.NEWAPI_API_KEY,
    newapiBase: env.NEWAPI_API_BASE_URL,
    mookoKey: env.MOOKO_API_KEY,
    mookoBase: env.MOOKO_API_BASE_URL,
    ithinkKey: env.ITHINK_API_KEY,
    ithinkBase: env.ITHINK_API_BASE_URL
  };
}

export function readJobProvider(meta: Record<string, unknown>): ImageUpstreamProvider {
  if (meta.provider === 'mooko') return 'mooko';
  if (meta.provider === 'ithink') return 'ithink';
  if (meta.provider === 'newapi') return 'newapi';
  if (meta.provider === 'apimart') return 'apimart';
  return 'grsai';
}

export function isProviderConfigured(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider
): boolean {
  if (provider === 'apimart') return !!bindings.apimartKey;
  if (provider === 'newapi') return !!bindings.newapiKey;
  if (provider === 'mooko') return !!bindings.mookoKey;
  if (provider === 'ithink') return !!bindings.ithinkKey;
  return !!bindings.grsaiKey;
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
    isViolation: /violation|违规|moderation|policy|prohibited|flagged as containing|upstream_content_violation/i.test(
      String(result.errorMessage || '')
    )
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
  if (provider === 'newapi') {
    if (!bindings.newapiKey) {
      return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
    }
    return apimartPollToUnified(
      await fetchNewApiTaskOnce(bindings.newapiKey, bindings.newapiBase, taskId)
    );
  }
  if (provider === 'mooko' || provider === 'ithink') {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
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
  if (provider === 'newapi') {
    if (!bindings.newapiKey) {
      return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
    }
    return apimartPollToUnified(
      await confirmNewApiTaskOutcome(bindings.newapiKey, bindings.newapiBase, taskId, opts)
    );
  }
  if (provider === 'mooko' || provider === 'ithink') {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  if (!bindings.grsaiKey) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  return confirmGrsaiTaskOutcome(bindings.grsaiKey, bindings.grsaiBase, taskId, opts);
}

/** 按用户所选线路提交（GrsAI / Apimart） */
export async function submitImageJobForProvider(
  bindings: ImageUpstreamBindings,
  provider: ImageUpstreamProvider,
  params: ImageSubmitParams
): Promise<ImageSubmitResult> {
  if (provider === 'apimart') {
    if (!bindings.apimartKey) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Apimart 线路未配置，请联系站长');
    }
    if (isMidjourneyUpstream(params.upstreamModel)) {
      const mjParams: SubmitMidjourneyParams = {
        upstreamModel: params.upstreamModel,
        prompt: params.prompt,
        size: params.size,
        refImageUrls: params.refImageUrls,
        mjParams: params.mjParams
      };
      const taskId = await submitMidjourneyImagine(bindings.apimartKey, bindings.apimartBase, mjParams);
      return { provider: 'apimart', taskId };
    }
    const taskId = await submitApimartImageJob(bindings.apimartKey, bindings.apimartBase, params);
    return { provider: 'apimart', taskId };
  }
  if (provider === 'newapi') {
    if (!bindings.newapiKey) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'New API 线路未配置，请联系站长');
    }
    const submitted = await submitNewApiImageJob(bindings.newapiKey, bindings.newapiBase, params);
    return {
      provider: 'newapi',
      taskId: submitted.taskId,
      immediateImageUrl: submitted.imageUrl,
      immediateImageUrls: submitted.imageUrls,
      upstreamRequestId: submitted.requestId
    };
  }
  if (!bindings.grsaiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'GrsAI 线路未配置，请联系站长');
  }
  const taskId = await submitGrsaiImageJob(bindings.grsaiKey, bindings.grsaiBase, {
    upstreamModel: params.upstreamModel,
    prompt: params.prompt,
    resolution: params.resolution,
    size: params.size,
    refImageUrls: params.refImageUrls
  });
  return { provider: 'grsai', taskId };
}

export function hasAnyImageUpstream(bindings: ImageUpstreamBindings): boolean {
  return !!(bindings.grsaiKey || bindings.apimartKey || bindings.newapiKey || bindings.mookoKey || bindings.ithinkKey);
}
