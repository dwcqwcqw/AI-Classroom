/**
 * Single TTS Generation API
 *
 * Generates TTS audio for a single text string and returns base64-encoded audio.
 * Called by the client in parallel for each speech action after a scene is generated.
 *
 * POST /api/generate/tts
 */

import { NextRequest } from 'next/server';
import { generateTTS } from '@/lib/audio/tts-providers';
import { resolveTTSApiKey, resolveTTSBaseUrl } from '@/lib/server/provider-config';
import { putSharedFile } from '@/lib/server/shared-files';
import type { TTSProviderId } from '@/lib/audio/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('TTS API');

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let ttsProviderId: string | undefined;
  let ttsVoice: string | undefined;
  let audioId: string | undefined;
  let stageId: string | undefined;
  try {
    const body = await req.json();
    const { text, ttsModelId, ttsSpeed, ttsApiKey, ttsBaseUrl } = body as {
      text: string;
      audioId: string;
      stageId?: string;
      ttsProviderId: TTSProviderId;
      ttsModelId?: string;
      ttsVoice: string;
      ttsSpeed?: number;
      ttsApiKey?: string;
      ttsBaseUrl?: string;
    };
    ttsProviderId = body.ttsProviderId;
    ttsVoice = body.ttsVoice;
    audioId = body.audioId;
    stageId = body.stageId;

    // Validate required fields
    if (!text || !audioId || !ttsProviderId || !ttsVoice) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required fields: text, audioId, ttsProviderId, ttsVoice',
      );
    }

    // Reject browser-native TTS — must be handled client-side
    if (ttsProviderId === 'browser-native-tts') {
      return apiError('INVALID_REQUEST', 400, 'browser-native-tts must be handled client-side');
    }

    const clientBaseUrl = ttsBaseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const apiKey = clientBaseUrl
      ? ttsApiKey || ''
      : resolveTTSApiKey(ttsProviderId, ttsApiKey || undefined);
    const baseUrl = clientBaseUrl
      ? clientBaseUrl
      : resolveTTSBaseUrl(ttsProviderId, ttsBaseUrl || undefined);

    // Build TTS config
    const config = {
      providerId: ttsProviderId as TTSProviderId,
      modelId: ttsModelId,
      voice: ttsVoice,
      speed: ttsSpeed ?? 1.0,
      apiKey,
      baseUrl,
    };

    log.info(
      `Generating TTS: provider=${ttsProviderId}, model=${ttsModelId || 'default'}, voice=${ttsVoice}, audioId=${audioId}, textLen=${text.length}`,
    );

    // Generate audio
    const { audio, format } = await generateTTS(config, text);

    const mimeType =
      format === 'wav'
        ? 'audio/wav'
        : format === 'ogg'
          ? 'audio/ogg'
          : format === 'aac'
            ? 'audio/aac'
            : 'audio/mpeg';

    let uploaded:
      | {
          id: string;
          objectKey: string;
          sizeBytes: number;
          kind: string;
          url: string;
        }
      | undefined;
    try {
      const uploadBytes = new Uint8Array(audio.byteLength);
      uploadBytes.set(audio);
      uploaded = await putSharedFile({
        fileName: `${audioId}.${format || 'mp3'}`,
        mimeType,
        data: uploadBytes.buffer,
        stageId,
        kind: 'audio',
      });
    } catch (uploadError) {
      log.warn(
        `TTS upload skipped [audioId=${audioId}, stageId=${stageId ?? 'global'}]:`,
        uploadError,
      );
    }

    // Convert to base64
    const base64 = Buffer.from(audio).toString('base64');

    return apiSuccess({
      audioId,
      base64,
      format,
      url: uploaded?.url,
      objectKey: uploaded?.objectKey,
      fileId: uploaded?.id,
    });
  } catch (error) {
    log.error(
      `TTS generation failed [provider=${ttsProviderId ?? 'unknown'}, voice=${ttsVoice ?? 'unknown'}, audioId=${audioId ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      'GENERATION_FAILED',
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
