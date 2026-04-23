/**
 * Verify Video Provider API
 *
 * Lightweight endpoint that validates provider credentials without generating video.
 *
 * POST /api/verify-video-provider
 *
 * Headers:
 *   x-video-provider: VideoProviderId
 *   x-video-model: string (optional)
 *   x-api-key: string (optional, server fallback)
 *   x-base-url: string (optional, server fallback)
 *
 * Response: { success: boolean, message: string }
 */

import { NextRequest } from 'next/server';
import { testVideoConnectivity } from '@/lib/media/video-providers';
import { resolveVideoApiKey, resolveVideoBaseUrl } from '@/lib/server/provider-config';
import type { VideoProviderId } from '@/lib/media/types';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('VerifyVideoProvider');

// Base64 decode helper for headers that may contain non-ISO-8859-1 characters
const decodeHeaderValue = (value: string | null): string | undefined => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return value;
  }
};

export async function POST(request: NextRequest) {
  try {
    const providerId = (decodeHeaderValue(request.headers.get('x-video-provider')) || 'seedance') as VideoProviderId;
    const model = decodeHeaderValue(request.headers.get('x-video-model'));
    const clientApiKey = decodeHeaderValue(request.headers.get('x-api-key'));
    const clientBaseUrl = decodeHeaderValue(request.headers.get('x-base-url'));

    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const apiKey = clientBaseUrl
      ? clientApiKey || ''
      : resolveVideoApiKey(providerId, clientApiKey);
    const baseUrl = clientBaseUrl ? clientBaseUrl : resolveVideoBaseUrl(providerId, clientBaseUrl);

    if (!apiKey) {
      return apiError('MISSING_API_KEY', 400, 'No API key configured');
    }

    const result = await testVideoConnectivity({
      providerId,
      apiKey,
      baseUrl,
      model,
    });

    if (!result.success) {
      return apiError('UPSTREAM_ERROR', 500, result.message);
    }

    return apiSuccess({ message: result.message });
  } catch (err) {
    log.error(
      `Video provider verification failed [provider=${request.headers.get('x-video-provider') ?? 'seedance'}]:`,
      err,
    );
    return apiError('INTERNAL_ERROR', 500, `Connectivity test error: ${err}`);
  }
}
