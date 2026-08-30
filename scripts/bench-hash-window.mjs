// Task 5 基准微测量：复现 scanner.calculateFileHash（sha256 流式），对比 1MB 与 64KB 窗口
// 用法：node scripts/bench-hash-window.mjs [采样目录] [采样数]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = process.argv[2] || path.join(process.cwd(), 'test-data', 'huge-library');
const sampleSize = Number(process.argv[3] || 200);

// 收集媒体文件（与 scanner 相同的扩展名口径，粗略取常见图片/音视频）
const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.flac', '.ogg', '.m4a']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name).toLowerCase())) files.push(p);
  }
})(dir);

const sample = files.slice(0, sampleSize);
console.log(`目录: ${dir}`);
console.log(`总媒体文件: ${files.length}, 采样: ${sample.length}`);

function hashFile(filePath, windowBytes) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { start: 0, end: windowBytes - 1 });
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function run(windowKB) {
  const windowBytes = windowKB * 1024;
  // 预热 OS 文件缓存
  for (const f of sample.slice(0, 20)) await hashFile(f, windowBytes);
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (const f of sample) {
    await hashFile(f, windowBytes);
    bytes += Math.min(fs.statSync(f).size, windowBytes);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, bytes };
}

const r1 = await run(1024);
const r64 = await run(64);

console.log(`\n1MB 窗口 : ${r1.ms.toFixed(1)}ms（读取 ${(r1.bytes / 1048576).toFixed(1)}MB）`);
console.log(`64KB 窗口: ${r64.ms.toFixed(1)}ms（读取 ${(r64.bytes / 1048576).toFixed(1)}MB）`);
console.log(`耗时降低 : ${((1 - r64.ms / r1.ms) * 100).toFixed(1)}%`);
console.log(`读取量降低: ${((1 - r64.bytes / r1.bytes) * 100).toFixed(1)}%`);
console.log(`单文件均值: 1MB=${(r1.ms / sample.length).toFixed(2)}ms, 64KB=${(r64.ms / sample.length).toFixed(2)}ms`);
