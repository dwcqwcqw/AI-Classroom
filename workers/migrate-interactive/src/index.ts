/**
 * 临时迁移 Worker：
 * 接收 HTML 内容，写入 R2 并写入 D1。
 * 迁移完成后通过 `wrangler delete` 删除。
 */

import type { R2Bucket, D1Database } from '@cloudflare/workers-types';

interface Env {
  FILES: R2Bucket;
  DB: D1Database;
  MIGRATION_SECRET: string;
}

const HTML_FILES = [
  { key: 'satellite', filename: '卫星轨道成像.html', sortOrder: 1 },
  { key: 'typhoon-structure', filename: '台风结构.html', sortOrder: 2 },
  { key: 'pressure-wind', filename: '气压与风速.html', sortOrder: 3 },
  { key: 'typhoon-config', filename: '调配台风.html', sortOrder: 4 },
  { key: 'lightning-hail', filename: '雷电与冰雹实验室.html', sortOrder: 5 },
  { key: 'coriolis', filename: '风的偏转.html', sortOrder: 6 },
];

const TITLES: Record<string, { zh: string; en: string }> = {
  satellite: {
    zh: '卫星轨道与成像原理模拟',
    en: 'Satellite Orbit & Imaging Simulator',
  },
  'typhoon-structure': {
    zh: '台风结构数据探测器',
    en: 'Typhoon Structure Probe',
  },
  'pressure-wind': {
    zh: '台风气象要素三维探测模拟',
    en: '3D Typhoon Weather Elements Simulation',
  },
  'typhoon-config': {
    zh: '台风形成条件模拟器',
    en: 'Typhoon Formation Simulator',
  },
  'lightning-hail': {
    zh: '雷电与冰雹生成模拟',
    en: 'Lightning & Hail Simulator',
  },
  coriolis: {
    zh: '不同纬度的科里奥利力与气旋模拟',
    en: 'Coriolis Force & Cyclone Simulation',
  },
};

const DESCRIPTIONS: Record<string, { zh: string; en: string }> = {
  satellite: {
    zh: '探索卫星在地球周围的运动轨迹与成像原理，通过调整轨道参数观察卫星位置的实时变化。',
    en: 'Explore satellite motion around Earth and imaging principles by adjusting orbital parameters.',
  },
  'typhoon-structure': {
    zh: '使用探测器探索台风内部的三维结构，观察台风眼、云墙、风眼墙等核心区域的物理参数。',
    en: 'Probe the 3D structure of typhoons using a data explorer, observing the eye, eyewall, and wind parameters.',
  },
  'pressure-wind': {
    zh: '在三维空间中实时探测气压、风速、温度等气象要素，直观理解台风不同区域的天气特征。',
    en: 'Real-time 3D probing of pressure, wind speed, and temperature to understand typhoon weather patterns.',
  },
  'typhoon-config': {
    zh: '调整海温、大气稳定度、科里奥利力等关键条件，模拟台风从胚胎到成熟的完整形成过程。',
    en: 'Adjust sea temperature, atmospheric stability, and Coriolis force to simulate typhoon formation from birth to maturity.',
  },
  'lightning-hail': {
    zh: '模拟雷暴云中雷电和冰雹的形成过程，理解对流运动、水成物碰撞等微观物理机制。',
    en: 'Simulate the formation of lightning and hail in thunderclouds, understanding microphysical mechanisms.',
  },
  coriolis: {
    zh: '在地球不同纬度上观察风向受科里奥利力偏转的影响，直观理解气旋与反气旋的形成原理。',
    en: 'Observe wind deflection by the Coriolis effect at different latitudes to understand cyclones and anticyclones.',
  },
};

async function ensureTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS interactive_files (
        id TEXT PRIMARY KEY,
        file_key TEXT UNIQUE,
        title TEXT NOT NULL,
        title_en TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        description_en TEXT NOT NULL DEFAULT '',
        object_key TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        thumbnail_key TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  try {
    await db.prepare('ALTER TABLE interactive_files ADD COLUMN file_key TEXT UNIQUE').run();
  } catch {
    // column already exists
  }
}

async function uploadFile(
  env: Env,
  key: string,
  title: { zh: string; en: string },
  desc: { zh: string; en: string },
  sortOrder: number,
  htmlContent: string,
): Promise<{ id: string; objectKey: string }> {
  const id = crypto.randomUUID();
  const objectKey = `interactive/${id}.html`;
  const now = Date.now();
  const bytes = new TextEncoder().encode(htmlContent).buffer;

  await env.FILES.put(objectKey, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { title: title.zh, titleEn: title.en },
  });

  await env.DB.prepare(
    `INSERT OR REPLACE INTO interactive_files
     (id, file_key, title, title_en, description, description_en, object_key, size_bytes, thumbnail_key, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, key, title.zh, title.en, desc.zh, desc.en, objectKey, bytes.byteLength, null, sortOrder, now)
    .run();

  return { id, objectKey };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const secret = request.headers.get('X-Migration-Secret');
    if (secret !== env.MIGRATION_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'list') {
      await ensureTable(env.DB);
      const { results } = await env.DB
        .prepare('SELECT id, title, object_key, sort_order FROM interactive_files ORDER BY sort_order ASC')
        .all();
      return Response.json({ files: results });
    }

    if (action === 'upload') {
      const body = (await request.json()) as {
        key: string;
        htmlContent: string;
      };

      const title = TITLES[body.key];
      const desc = DESCRIPTIONS[body.key];
      const fileMeta = HTML_FILES.find((f) => f.key === body.key);

      if (!title || !desc || !fileMeta) {
        return Response.json({ error: 'Unknown key: ' + body.key }, { status: 400 });
      }

      await ensureTable(env.DB);
      const result = await uploadFile(env, body.key, title, desc, fileMeta.sortOrder, body.htmlContent);

      return Response.json({ ok: true, id: result.id, objectKey: result.objectKey });
    }

    if (action === 'migrate-all') {
      const body = (await request.json()) as Array<{ key: string; htmlContent: string }>;
      await ensureTable(env.DB);
      const results = [];

      for (const item of body) {
        const title = TITLES[item.key];
        const desc = DESCRIPTIONS[item.key];
        const fileMeta = HTML_FILES.find((f) => f.key === item.key);
        if (!title || !desc || !fileMeta) {
          results.push({ key: item.key, ok: false, error: 'Unknown key' });
          continue;
        }
        try {
          const result = await uploadFile(env, item.key, title, desc, fileMeta.sortOrder, item.htmlContent);
          results.push({ key: item.key, ok: true, id: result.id });
        } catch (e) {
          results.push({ key: item.key, ok: false, error: String(e) });
        }
      }

      return Response.json({ ok: true, results });
    }

    return Response.json({
      usage: 'GET ?action=list | POST ?action=upload | POST ?action=migrate-all',
    });
  },
};
