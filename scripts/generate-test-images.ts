/**
 * 生成测试图片脚本
 * 用于本地测试缩略图缓存系统、多库管理、文件夹树等功能
 *
 * 使用方法:
 * npx tsx scripts/generate-test-images.ts [命令]
 *
 * 命令:
 *   default     - 生成基础测试库 (100 张)
 *   large       - 生成大型测试库 (1000 张，用于性能测试)
 *   multi       - 生成多个测试库 (用于多库管理测试)
 *   tree        - 生成带多级文件夹的测试库 (用于文件夹树测试)
 *   huge        - 生成超大型测试库 (110 个子文件夹，每文件夹 60-80 张，每张约 6MB)
 *   all         - 生成以上所有测试库
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// 统一测试数据目录
const TEST_DATA_ROOT = path.join(projectRoot, 'test-data');

// 各测试库路径（统一在 test-data 目录下）
const TEST_LIBRARY_PATH = path.join(TEST_DATA_ROOT, 'test-library');
const LARGE_LIBRARY_PATH = path.join(TEST_DATA_ROOT, 'large-library');
const MULTI_LIBRARY_1_PATH = path.join(TEST_DATA_ROOT, 'multi-library-1');
const MULTI_LIBRARY_2_PATH = path.join(TEST_DATA_ROOT, 'multi-library-2');
const TREE_LIBRARY_PATH = path.join(TEST_DATA_ROOT, 'tree-library');
const HUGE_LIBRARY_PATH = path.join(TEST_DATA_ROOT, 'huge-library');

// 基础生成配置
const BASE_CONFIG = {
  baseWidth: 1920,
  baseHeight: 1080,
  variance: 800,
};

// 超大型库配置（6MB 图片）
const HUGE_CONFIG = {
  folderCount: 110,           // 110 个子文件夹
  minImagesPerFolder: 60,     // 每个文件夹最少 60 张
  maxImagesPerFolder: 80,     // 每个文件夹最多 80 张
  baseWidth: 4096,            // 4K 分辨率基础宽度
  baseHeight: 2304,           // 4K 分辨率基础高度
  quality: 85,                // 中等质量（平衡文件大小）
};

// 全局配置（可被不同命令覆盖）
let CONFIG = { ...BASE_CONFIG, totalImages: 100, imagesPerSet: 10 };

/**
 * 生成随机颜色
 */
function randomColor(): { r: number; g: number; b: number } {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
  };
}

/**
 * 生成随机尺寸
 */
function randomSize(): { width: number; height: number } {
  const width = CONFIG.baseWidth + Math.floor(Math.random() * CONFIG.variance) - CONFIG.variance / 2;
  const height = CONFIG.baseHeight + Math.floor(Math.random() * CONFIG.variance) - CONFIG.variance / 2;
  return {
    width: Math.max(800, Math.floor(width)),
    height: Math.max(600, Math.floor(height)),
  };
}

/**
 * 生成单张测试图片（标准质量）
 */
async function generateImage(filePath: string, index: number, label?: string): Promise<void> {
  const { width, height } = randomSize();
  const color = randomColor();
  const displayLabel = label || `Image #${index}`;

  const gradient = Buffer.from(
    `<svg width="${width}" height="${height}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(${color.r},${color.g},${color.b});stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgb(${(color.r + 50) % 256},${(color.g + 50) % 256},${(color.b + 50) % 256});stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.min(width, height) / 20}"
            fill="white" text-anchor="middle" dominant-baseline="middle" font-weight="bold">
        ${displayLabel}
      </text>
      <text x="50%" y="60%" font-family="Arial" font-size="${Math.min(width, height) / 40}"
            fill="rgba(255,255,255,0.8)" text-anchor="middle">
        ${width} x ${height}
      </text>
    </svg>`
  );

  await sharp(gradient)
    .jpeg({ quality: 90 })
    .toFile(filePath);
}

/**
 * 生成高质量大图片（约 6MB）
 * 使用 raw 像素数据生成，包含大量高频细节（噪点）以降低 JPEG 压缩率
 */
async function generateHugeImage(filePath: string, index: number, folderName: string): Promise<void> {
  const width = HUGE_CONFIG.baseWidth + Math.floor(Math.random() * 1000) - 500;
  const height = HUGE_CONFIG.baseHeight + Math.floor(Math.random() * 1000) - 500;
  
  // 创建基础颜色
  const baseR = Math.floor(Math.random() * 150) + 50;
  const baseG = Math.floor(Math.random() * 150) + 50;
  const baseB = Math.floor(Math.random() * 150) + 50;
  
  // 生成 raw 像素数据 - 带高频噪点
  const pixelCount = width * height;
  const rawData = Buffer.alloc(pixelCount * 3);
  
  // 生成带渐变和噪点的像素
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      
      // 渐变基础
      const gradFactor = (x / width + y / height) / 2;
      
      // 高频噪点（关键：让 JPEG 难以压缩）
      const noiseIntensity = 60;
      const noiseR = Math.floor((Math.random() - 0.5) * noiseIntensity * 2);
      const noiseG = Math.floor((Math.random() - 0.5) * noiseIntensity * 2);
      const noiseB = Math.floor((Math.random() - 0.5) * noiseIntensity * 2);
      
      // 棋盘格图案（增加高频成分）
      const checkerSize = 8;
      const checker = ((Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2) * 30;
      
      rawData[idx] = Math.max(0, Math.min(255, baseR + gradFactor * 80 + noiseR + checker));
      rawData[idx + 1] = Math.max(0, Math.min(255, baseG + gradFactor * 80 + noiseG + checker));
      rawData[idx + 2] = Math.max(0, Math.min(255, baseB + gradFactor * 80 + noiseB + checker));
    }
  }
  
  // 使用 sharp 处理 raw 数据并添加文字
  const image = sharp(rawData, {
    raw: { width, height, channels: 3 }
  });
  
  // 合成文字层
  const textSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="transparent"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.min(width, height) / 12}" 
            fill="white" text-anchor="middle" dominant-baseline="middle" font-weight="bold"
            style="text-shadow: 3px 3px 6px rgba(0,0,0,0.8); -webkit-text-stroke: 1px black;">
        ${folderName} #${String(index).padStart(4, '0')}
      </text>
      <text x="50%" y="60%" font-family="Arial" font-size="${Math.min(width, height) / 40}" 
            fill="white" text-anchor="middle"
            style="text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">
        ${width} × ${height} • High Noise Test Image
      </text>
    </svg>
  `);
  
  await image
    .jpeg({ quality: HUGE_CONFIG.quality, mozjpeg: false })
    .composite([{
      input: textSvg,
      top: 0,
      left: 0
    }])
    .toFile(filePath);
}

/**
 * 生成基础测试库 (100 张)
 */
async function generateDefaultLibrary(): Promise<void> {
  CONFIG = { ...BASE_CONFIG, totalImages: 100, imagesPerSet: 10 };

  console.log('📦 生成基础测试库 (test-data/test-library/)...\n');
  console.log(`配置:`);
  console.log(`  总图片数：${CONFIG.totalImages}`);
  console.log(`  图集数量：${Math.ceil(CONFIG.totalImages / CONFIG.imagesPerSet)}`);
  console.log(`  输出目录：${TEST_LIBRARY_PATH}\n`);

  const startTime = Date.now();

  if (!fs.existsSync(TEST_LIBRARY_PATH)) {
    fs.mkdirSync(TEST_LIBRARY_PATH, { recursive: true });
  }

  let imageIndex = 1;
  const setCount = Math.ceil(CONFIG.totalImages / CONFIG.imagesPerSet);

  for (let setNum = 1; setNum <= setCount; setNum++) {
    const setDir = path.join(TEST_LIBRARY_PATH, `set${String(setNum).padStart(2, '0')}`);

    if (!fs.existsSync(setDir)) {
      fs.mkdirSync(setDir, { recursive: true });
    }

    console.log(`📁 生成图集 ${setNum}/${setCount}: ${path.basename(setDir)}`);

    const imagesInSet = Math.min(CONFIG.imagesPerSet, CONFIG.totalImages - imageIndex + 1);

    for (let i = 0; i < imagesInSet; i++) {
      const filePath = path.join(setDir, `photo${String(imageIndex).padStart(3, '0')}.jpg`);
      await generateImage(filePath, imageIndex);
      console.log(`  ✓ ${path.basename(filePath)}`);
      imageIndex++;
    }
    console.log();
  }

  const duration = Date.now() - startTime;
  console.log('✅ 基础测试库生成完成!\n');
  printStats(CONFIG.totalImages, duration);
}

/**
 * 生成大型测试库 (1000 张，用于性能测试)
 */
async function generateLargeLibrary(): Promise<void> {
  CONFIG = { ...BASE_CONFIG, totalImages: 1000, imagesPerSet: 50 };

  console.log('📦 生成大型测试库 (test-data/large-library/) - 性能测试用...\n');
  console.log(`配置:`);
  console.log(`  总图片数：${CONFIG.totalImages}`);
  console.log(`  图集数量：${Math.ceil(CONFIG.totalImages / CONFIG.imagesPerSet)}`);
  console.log(`  输出目录：${LARGE_LIBRARY_PATH}\n`);

  const startTime = Date.now();

  if (!fs.existsSync(LARGE_LIBRARY_PATH)) {
    fs.mkdirSync(LARGE_LIBRARY_PATH, { recursive: true });
  }

  let imageIndex = 1;
  const setCount = Math.ceil(CONFIG.totalImages / CONFIG.imagesPerSet);

  for (let setNum = 1; setNum <= setCount; setNum++) {
    const setDir = path.join(LARGE_LIBRARY_PATH, `set${String(setNum).padStart(2, '0')}`);

    if (!fs.existsSync(setDir)) {
      fs.mkdirSync(setDir, { recursive: true });
    }

    console.log(`📁 生成图集 ${setNum}/${setCount}`);

    const imagesInSet = Math.min(CONFIG.imagesPerSet, CONFIG.totalImages - imageIndex + 1);

    for (let i = 0; i < imagesInSet; i++) {
      const filePath = path.join(setDir, `photo${String(imageIndex).padStart(3, '0')}.jpg`);
      await generateImage(filePath, imageIndex);
      imageIndex++;
    }
  }

  const duration = Date.now() - startTime;
  console.log('\n✅ 大型测试库生成完成!\n');
  printStats(CONFIG.totalImages, duration);
}

/**
 * 生成多个测试库 (用于多库管理测试)
 */
async function generateMultiLibraries(): Promise<void> {
  CONFIG = { ...BASE_CONFIG, totalImages: 50, imagesPerSet: 10 };

  console.log('📦 生成多库测试数据 (test-data/multi-library-1/, test-data/multi-library-2/)...\n');

  const libraries = [
    { path: MULTI_LIBRARY_1_PATH, name: 'Multi Library 1', prefix: 'M1' },
    { path: MULTI_LIBRARY_2_PATH, name: 'Multi Library 2', prefix: 'M2' },
  ];

  for (const lib of libraries) {
    console.log(`📁 生成 ${lib.name}...`);

    if (!fs.existsSync(lib.path)) {
      fs.mkdirSync(lib.path, { recursive: true });
    }

    for (let i = 1; i <= CONFIG.totalImages; i++) {
      const filePath = path.join(lib.path, `${lib.prefix}_photo${String(i).padStart(3, '0')}.jpg`);
      await generateImage(filePath, i, `${lib.name} #${i}`);
    }

    console.log(`  ✓ 生成 ${CONFIG.totalImages} 张图片\n`);
  }

  console.log('✅ 多库测试数据生成完成!\n');
}

/**
 * 生成带多级文件夹的测试库 (用于文件夹树测试)
 */
async function generateTreeLibrary(): Promise<void> {
  CONFIG = BASE_CONFIG;

  console.log('📦 生成树形文件夹测试库 (test-data/tree-library/) - 文件夹树测试用...\n');
  console.log(`输出目录：${TREE_LIBRARY_PATH}\n`);

  const startTime = Date.now();
  let totalImages = 0;

  if (!fs.existsSync(TREE_LIBRARY_PATH)) {
    fs.mkdirSync(TREE_LIBRARY_PATH, { recursive: true });
  }

  // 目录结构定义
  const folderStructure = [
    // 根目录直接放一些图片
    { dir: '', count: 20 },
    // 一级文件夹
    { dir: 'Folder-A', count: 30 },
    { dir: 'Folder-B', count: 25 },
    { dir: 'Folder-C', count: 35 },
    // 二级文件夹
    { dir: 'Folder-A/Sub-A1', count: 20 },
    { dir: 'Folder-A/Sub-A2', count: 15 },
    { dir: 'Folder-B/Sub-B1', count: 25 },
    { dir: 'Folder-B/Sub-B2', count: 20 },
    { dir: 'Folder-C/Sub-C1', count: 30 },
    // 三级文件夹
    { dir: 'Folder-A/Sub-A1/Deep-A1a', count: 15 },
    { dir: 'Folder-A/Sub-A1/Deep-A1b', count: 10 },
    { dir: 'Folder-B/Sub-B1/Deep-B1a', count: 20 },
    { dir: 'Folder-C/Sub-C1/Deep-C1a', count: 15 },
  ];

  let imageIndex = 1;

  for (const folder of folderStructure) {
    const dirPath = folder.dir ? path.join(TREE_LIBRARY_PATH, folder.dir) : TREE_LIBRARY_PATH;

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const dirName = folder.dir || '根目录';
    console.log(`📁 生成 ${dirName} (${folder.count} 张)...`);

    for (let i = 0; i < folder.count; i++) {
      const filePath = path.join(dirPath, `photo${String(imageIndex).padStart(3, '0')}.jpg`);
      await generateImage(filePath, imageIndex, `Tree #${imageIndex}`);
      imageIndex++;
      totalImages++;
    }
    console.log(`  ✓ 完成\n`);
  }

  const duration = Date.now() - startTime;
  console.log('✅ 树形文件夹测试库生成完成!\n');
  printStats(totalImages, duration);
}

/**
 * 生成超大型测试库 (110 个子文件夹，每文件夹 60-80 张，每张约 6MB)
 */
async function generateHugeLibrary(): Promise<void> {
  console.log('📦 生成超大型测试库 (test-data/huge-library/) - 极端性能测试用...\n');
  console.log('⚠️  警告：此测试库将生成约 7700 张图片，每条约 6MB，总大小约 46GB');
  console.log('⚠️  生成时间可能需要数小时，请确保有足够的磁盘空间\n');
  console.log(`配置:`);
  console.log(`  子文件夹数：${HUGE_CONFIG.folderCount}`);
  console.log(`  每文件夹图片数：${HUGE_CONFIG.minImagesPerFolder} - ${HUGE_CONFIG.maxImagesPerFolder}`);
  console.log(`  图片分辨率：${HUGE_CONFIG.baseWidth} x ${HUGE_CONFIG.baseHeight} (8K)`);
  console.log(`  图片质量：${HUGE_CONFIG.quality}%`);
  console.log(`  输出目录：${HUGE_LIBRARY_PATH}\n`);

  const startTime = Date.now();

  if (!fs.existsSync(HUGE_LIBRARY_PATH)) {
    fs.mkdirSync(HUGE_LIBRARY_PATH, { recursive: true });
  }

  let totalImages = 0;
  let totalSizeBytes = 0;

  for (let folderNum = 1; folderNum <= HUGE_CONFIG.folderCount; folderNum++) {
    const folderName = `Folder_${String(folderNum).padStart(3, '0')}`;
    const folderPath = path.join(HUGE_LIBRARY_PATH, folderName);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const imagesInFolder = Math.floor(
      Math.random() * (HUGE_CONFIG.maxImagesPerFolder - HUGE_CONFIG.minImagesPerFolder + 1)
    ) + HUGE_CONFIG.minImagesPerFolder;

    console.log(`📁 生成 ${folderName} (${imagesInFolder} 张)...`);

    const folderStartTime = Date.now();

    for (let i = 1; i <= imagesInFolder; i++) {
      const filePath = path.join(folderPath, `photo${String(i).padStart(4, '0')}.jpg`);
      await generateHugeImage(filePath, i, folderName);
      totalImages++;

      // 显示进度
      if (i % 10 === 0 || i === imagesInFolder) {
        const fileSize = fs.statSync(filePath).size;
        totalSizeBytes += fileSize;
        const elapsed = ((Date.now() - folderStartTime) / 1000).toFixed(1);
        const avgMs = (elapsed * 1000 / i).toFixed(0);
        console.log(`   进度：${i}/${imagesInFolder} | 平均：${avgMs}ms/张 | 当前大小：${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB`);
      }
    }

    const folderDuration = ((Date.now() - folderStartTime) / 1000).toFixed(1);
    console.log(`  ✓ 完成 (耗时：${folderDuration}s, 大小：${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB)\n`);
  }

  const duration = Date.now() - startTime;
  const hours = Math.floor(duration / 3600000);
  const minutes = Math.floor((duration % 3600000) / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(1);

  console.log('✅ 超大型测试库生成完成!\n');
  console.log(`   总图片数：${totalImages}`);
  console.log(`   总大小：${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB`);
  console.log(`   总耗时：${hours}h ${minutes}m ${seconds}s`);
  console.log(`   平均每张：${(duration / totalImages).toFixed(0)}ms`);
}

/**
 * 生成所有测试库
 */
async function generateAll(): Promise<void> {
  console.log('🎨 开始生成所有测试库...\n');
  console.log('='.repeat(60));
  console.log();

  await generateDefaultLibrary();
  console.log('='.repeat(60));
  console.log();

  await generateLargeLibrary();
  console.log('='.repeat(60));
  console.log();

  await generateMultiLibraries();
  console.log('='.repeat(60));
  console.log();

  await generateTreeLibrary();
  console.log('='.repeat(60));
  console.log();

  console.log('🎉 标准测试库生成完成!\n');
  console.log('生成的测试库 (均在 test-data/ 目录下):');
  console.log('  - test-library/      : 100 张 (基础功能测试)');
  console.log('  - large-library/     : 1000 张 (性能测试)');
  console.log('  - multi-library-1/   : 50 张 (多库管理测试)');
  console.log('  - multi-library-2/   : 50 张 (多库管理测试)');
  console.log('  - tree-library/      : 280 张 (文件夹树测试)');
  console.log('\n总图片数：1530 张');
  console.log('\n' + '='.repeat(60));
  console.log('\n⚠️  超大型测试库 (huge-library) 需要单独生成');
  console.log('   命令：npx tsx scripts/generate-test-images.ts huge');
  console.log('   预计大小：~46GB, 预计时间：数小时\n');
}

/**
 * 打印统计信息
 */
function printStats(totalImages: number, duration: number): void {
  console.log(`   总图片数：${totalImages}`);
  console.log(`   耗时：${duration}ms`);
  console.log(`   平均：${(duration / totalImages).toFixed(1)}ms/张`);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const command = process.argv[2] || 'default';

  switch (command) {
    case 'default':
      await generateDefaultLibrary();
      break;
    case 'large':
      await generateLargeLibrary();
      break;
    case 'multi':
      await generateMultiLibraries();
      break;
    case 'tree':
      await generateTreeLibrary();
      break;
    case 'huge':
      await generateHugeLibrary();
      break;
    case 'all':
      await generateAll();
      break;
    default:
      console.log('❌ 未知命令:', command);
      console.log('\n可用命令:');
      console.log('  default  - 生成基础测试库 (100 张)');
      console.log('  large    - 生成大型测试库 (1000 张)');
      console.log('  multi    - 生成多个测试库');
      console.log('  tree     - 生成树形文件夹测试库');
      console.log('  huge     - 生成超大型测试库 (110 文件夹，~7700 张，~46GB)');
      console.log('  all      - 生成所有测试库 (不含 huge)');
      console.log('\n示例：npx tsx scripts/generate-test-images.ts all');
  }
}

// 运行
main().catch(console.error);
