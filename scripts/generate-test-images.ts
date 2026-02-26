/**
 * 生成测试图片脚本
 * 用于本地测试缩略图缓存系统
 * 
 * 使用方法:
 * npx tsx scripts/generate-test-images.ts
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// 测试库路径
const TEST_LIBRARY_PATH = path.join(projectRoot, 'test-library');

// 生成配置
const CONFIG = {
  totalImages: 100,        // 总图片数
  imagesPerSet: 10,        // 每个图集的图片数
  baseWidth: 1920,         // 基础宽度
  baseHeight: 1080,        // 基础高度
  variance: 800,           // 尺寸随机变化范围
};

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
 * 生成单张测试图片
 */
async function generateImage(filePath: string, index: number): Promise<void> {
  const { width, height } = randomSize();
  const color = randomColor();
  
  // 创建渐变背景
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
        Image #${index}
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
  
  console.log(`  ✓ ${path.basename(filePath)} (${width}x${height})`);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('🎨 开始生成测试图片...\n');
  console.log(`配置:`);
  console.log(`  总图片数：${CONFIG.totalImages}`);
  console.log(`  图集数量：${Math.ceil(CONFIG.totalImages / CONFIG.imagesPerSet)}`);
  console.log(`  输出目录：${TEST_LIBRARY_PATH}\n`);

  const startTime = Date.now();

  // 创建目录
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
      const filePath = path.join(
        setDir, 
        `photo${String(imageIndex).padStart(3, '0')}.jpg`
      );
      
      await generateImage(filePath, imageIndex);
      imageIndex++;
    }

    console.log();
  }

  const duration = Date.now() - startTime;
  
  console.log('✅ 生成完成!');
  console.log(`   总图片数：${CONFIG.totalImages}`);
  console.log(`   耗时：${duration}ms`);
  console.log(`   平均：${(duration / CONFIG.totalImages).toFixed(1)}ms/张`);
  console.log(`   目录：${TEST_LIBRARY_PATH}`);
}

// 运行
main().catch(console.error);
