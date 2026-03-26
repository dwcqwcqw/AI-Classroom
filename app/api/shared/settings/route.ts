import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { readSharedSetting, writeSharedSetting } from '@/lib/server/shared-data';

const GLOBAL_SETTINGS_KEY = 'global-settings';

export async function GET() {
  try {
    const settings = await readSharedSetting<Record<string, unknown>>(GLOBAL_SETTINGS_KEY);
    return apiSuccess({ settings: settings ?? {} });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load global settings',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const settings = body?.settings;
    if (!settings || typeof settings !== 'object') {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required field: settings');
    }

    await writeSharedSetting(GLOBAL_SETTINGS_KEY, settings);
    return apiSuccess({ ok: true });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to save global settings',
      error instanceof Error ? error.message : String(error),
    );
  }
}
