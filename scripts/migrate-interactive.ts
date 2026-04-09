/**
 * 迁移脚本：将 interactive/*.html 上传到 R2 并写入 D1
 * 用法（本地 wrangler）：
 *   npx wrangler d1 execute ai-classroom-db --local --file=<(echo "SELECT 1")
 *   npx ts-node --esm scripts/migrate-interactive.ts
 *
 * 或者直接在 Cloudflare Dashboard 的 D1 编辑器中执行建表 SQL，
 * 然后用 wrangler r2 object put 批量上传文件。
 *
 * 本脚本设计为在 Cloudflare Workers 环境中运行一次即可。
 */
import { getR2 } from '../lib/server/cloudflare-r2';
import { getD1 } from '../lib/server/cloudflare-d1';
import { ensureInteractiveTables, putInteractiveFile } from '../lib/server/interactive-files';

const INTERACTIVE_FILES = [
  {
    filename: '卫星轨道成像.html',
    title: '卫星轨道与成像原理模拟',
    titleEn: 'Satellite Orbit & Imaging Simulator',
    description: '探索卫星在地球周围的运动轨迹与成像原理，通过调整轨道参数观察卫星位置的实时变化。',
    descriptionEn: 'Explore satellite motion around Earth and imaging principles by adjusting orbital parameters.',
    sortOrder: 1,
  },
  {
    filename: '台风结构.html',
    title: '台风结构数据探测器',
    titleEn: 'Typhoon Structure Probe',
    description: '使用探测器探索台风内部的三维结构，观察台风眼、云墙、风眼墙等核心区域的物理参数。',
    descriptionEn: 'Probe the 3D structure of typhoons using a data explorer, observing the eye, eyewall, and wind parameters.',
    sortOrder: 2,
  },
  {
    filename: '气压与风速.html',
    title: '台风气象要素三维探测模拟',
    titleEn: '3D Typhoon Weather Elements Simulation',
    description: '在三维空间中实时探测气压、风速、温度等气象要素，直观理解台风不同区域的天气特征。',
    descriptionEn: 'Real-time 3D probing of pressure, wind speed, and temperature to understand typhoon weather patterns.',
    sortOrder: 3,
  },
  {
    filename: '调配台风.html',
    title: '台风形成条件模拟器',
    titleEn: 'Typhoon Formation Simulator',
    description: '调整海温、大气稳定度、科里奥利力等关键条件，模拟台风从胚胎到成熟的完整形成过程。',
    descriptionEn: 'Adjust sea temperature, atmospheric stability, and Coriolis force to simulate typhoon formation from birth to maturity.',
    sortOrder: 4,
  },
  {
    filename: '雷电与冰雹实验室.html',
    title: '雷电与冰雹生成模拟',
    titleEn: 'Lightning & Hail Simulator',
    description: '模拟雷暴云中雷电和冰雹的形成过程，理解对流运动、水成物碰撞等微观物理机制。',
    descriptionEn: 'Simulate the formation of lightning and hail in thunderclouds, understanding microphysical mechanisms.',
    sortOrder: 5,
  },
  {
    filename: '风的偏转.html',
    title: '不同纬度的科里奥利力与气旋模拟',
    titleEn: 'Coriolis Force & Cyclone Simulation',
    description: '在地球不同纬度上观察风向受科里奥利力偏转的影响，直观理解气旋与反气旋的形成原理。',
    descriptionEn: 'Observe wind deflection by the Coriolis effect at different latitudes to understand cyclones and anticyclones.',
    sortOrder: 6,
  },
];

async function migrate() {
  const r2 = getR2();
  const db = getD1();
  if (!r2 || !db) {
    console.error('R2 or D1 not available in this environment');
    process.exit(1);
  }

  console.log('Creating tables...');
  await ensureInteractiveTables(db);

  for (const entry of INTERACTIVE_FILES) {
    const filePath = `interactive/${entry.filename}`;
    console.log(`Processing: ${filePath}`);

    // Read HTML file from local disk (Worker filesystem)
    let htmlContent: string;
    try {
      // In Node/dev environment read from disk
      const fs = await import('fs/promises');
      const path = await import('path');
      const fullPath = path.join(process.cwd(), 'interactive', entry.filename);
      htmlContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      console.warn(`Could not read ${entry.filename}, skipping...`);
      continue;
    }

    try {
      const result = await putInteractiveFile({
        title: entry.title,
        titleEn: entry.titleEn,
        description: entry.description,
        descriptionEn: entry.descriptionEn,
        htmlContent,
        sortOrder: entry.sortOrder,
      });
      console.log(`  ✓ Uploaded: ${result.id} → ${result.objectKey}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${entry.filename}`, err);
    }
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
