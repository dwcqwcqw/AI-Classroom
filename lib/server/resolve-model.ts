/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
  /** Effective API key after server-side fallback resolution */
  apiKey: string;
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body.
 */
export function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}): ResolvedModel {
  const modelString = params.modelString || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
  const { providerId, modelId } = parseModelString(modelString);

  const clientBaseUrl = params.baseUrl || undefined;
  if (clientBaseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const apiKey = clientBaseUrl
    ? params.apiKey || ''
    : resolveApiKey(providerId, params.apiKey || '');
  const baseUrl = clientBaseUrl ? clientBaseUrl : resolveBaseUrl(providerId, params.baseUrl);
  const proxy = resolveProxy(providerId);
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return { model, modelInfo, modelString, apiKey };
}

/**
 * Decode a Base64-encoded header value that may contain non-ISO-8859-1 characters.
 */
function decodeHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return value;
  }
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type, x-requires-api-key
 * Note: x-model, x-api-key, x-base-url are Base64-encoded to support non-ISO-8859-1 characters
 */
export function resolveModelFromHeaders(req: NextRequest): ResolvedModel {
  return resolveModel({
    modelString: decodeHeaderValue(req.headers.get('x-model')),
    apiKey: decodeHeaderValue(req.headers.get('x-api-key')),
    baseUrl: decodeHeaderValue(req.headers.get('x-base-url')),
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
  });
}
