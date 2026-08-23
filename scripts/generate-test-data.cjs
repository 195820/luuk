const fs = require('fs');
const path = require('path');

async function main() {
  const targetDir = process.argv[2];
  const count = parseInt(process.argv[3]) || 100;
  if (!targetDir) {
    console.error('用法: node scripts/generate-test-data.js <目标路径> [数量]');
    process.exit(1);
  }

  const sharp = require('sharp');
  fs.mkdirSync(targetDir, { recursive: true });
  const folders = ['portrait', 'outdoor', 'studio'];
  folders.forEach(f => fs.mkdirSync(path.join(targetDir, f), { recursive: true }));

  for (let i = 0; i < count; i++) {
    const folder = folders[i % folders.length];
    const filePath = path.join(targetDir, folder, `IMG_${String(i + 1).padStart(4, '0')}.jpg`);
    if (!fs.existsSync(filePath)) {
      await sharp({
        create: {
          width: 1920, height: 1280, channels: 3,
          background: { r: Math.floor(Math.random() * 256), g: Math.floor(Math.random() * 256), b: Math.floor(Math.random() * 256) }
        }
      }).jpeg({ quality: 85 }).toFile(filePath);
    }
  }
  console.log(`已生成 ${count} 张测试图片到 ${targetDir}`);
}
main().catch(console.error);
