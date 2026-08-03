import type { Env } from '../env';
import { MIN_CREDIT_CHARGE, roundCredits } from './credit-math';
import { ApiError } from './errors';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  newApiKeyForRoute,
  newApiTextCreditsForUsage,
  resolveNewApiCatalogModel,
  resolveNewApiRoutedCatalogModel,
  type NewApiCatalogModel,
  type NewApiResolvedCatalogModel
} from './newapi';

export const DEFAULT_PUBLIC_TEXT_MODEL = 'deepseek-v4-flash';

type NewApiTextBindings = Pick<
  Env,
  'NEWAPI_API_KEY' | 'NEWAPI_API_BASE_URL' | 'NEWAPI_CATALOG_ADMIN_SECRET'
>;

export type FreshNewApiTextModel = NewApiResolvedCatalogModel & {
  publicIdentity: { model: string; modelLabel: string };
};

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 3));
}

export function billableNewApiTextCredits(
  model: NewApiCatalogModel,
  inputTokens: number,
  outputTokens: number
): number | null {
  const credits = newApiTextCreditsForUsage(model, inputTokens, outputTokens);
  if (credits == null || !Number.isFinite(credits)) return null;
  return Math.max(MIN_CREDIT_CHARGE, roundCredits(credits));
}

export async function fetchFreshNewApiTextModels(
  env: NewApiTextBindings,
  modelIds: string[]
): Promise<FreshNewApiTextModel[]> {
  const baseUrl = env.NEWAPI_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '文字服务暂未配置');
  }

  let snapshot;
  try {
    snapshot = await fetchNewApiModelCatalog(baseUrl, {
      force: true,
      requireFresh: true
    });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认实时价格，请稍后重试');
  }

  const routes = await fetchNewApiAdminRoutes(
    baseUrl,
    env.NEWAPI_CATALOG_ADMIN_SECRET
  );
  const result: FreshNewApiTextModel[] = [];
  for (const modelId of modelIds) {
    const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, modelId, 'text');
    if (!resolved) {
      throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选文字模型已不可用，请刷新后重选');
    }
    const publicModel = resolveNewApiCatalogModel(snapshot, resolved.model.upstreamModel, 'text');
    result.push({
      ...resolved,
      publicIdentity: publicModel
        ? { model: publicModel.id, modelLabel: publicModel.label }
        : { model: 'creative-model', modelLabel: '创作模型' }
    });
  }
  return result;
}

export async function fetchFreshNewApiTextModel(
  env: NewApiTextBindings,
  modelId: string
): Promise<FreshNewApiTextModel> {
  return (await fetchFreshNewApiTextModels(env, [modelId]))[0];
}

export function newApiTextRequestTarget(
  env: NewApiTextBindings,
  resolved: FreshNewApiTextModel
) {
  const apiKey = env.NEWAPI_API_KEY?.trim();
  const baseUrl = env.NEWAPI_API_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '文字服务暂未配置');
  }
  return {
    apiKey: newApiKeyForRoute(apiKey, resolved.route),
    baseUrl,
    model: resolved.model.upstreamModel
  };
}
