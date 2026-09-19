// 媒体加载性能基线测量：为「媒体加载性能提升方案」P0/P2 提供数据决策依据
// 用法：node scripts/bench-media-memory.mjs [库路径] [采样数]
// 示例：node scripts/bench-media-memory.mjs test-library 60
//
// 测量维度：
//   A. 缩略图 WebP vs JPEG 体积（P2-1 决策）
//   B. base64/data:URL vs Uint8Array 内存膨胀（P0-1 收益）
//   C. 批量生成吞吐 + 进程 RSS 峰值（P1-2 限流验证）
//   D. LRU 缓存命中率（P0-1/P0-2 收益，目标 ≥70%）
//   E. IPC base64 全量传输 vs media:// URL+缓存 传输量（P0-2 收益）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const LIB_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const libraryPath = process.argv[2] || path.join(process.cwd(), 'test-library');
const sampleSize = Number(process.argv[3] || 80);

if (!fs.existsSync(libraryPath)) {
  console.error(`错误: 库路径不存在: ${libraryPath}`);
  process.exit(1);
}

// 递归收集图片
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (LIB_EXTS.has(path.extname(e.name).toLowerCase())) files.push(p);
  }
})(libraryPath);

const sample = files.slice(0, sampleSize);
if (sample.length === 0) {
  console.error('错误: 未找到可采样的图片');
  process.exit(1);
}

// 与 thumbnailer.ts DEFAULT_CONFIG 对齐
const THUMB_WIDTH = 320;
const WEBP_QUALITY = 75;
const JPEG_QUALITY = 80;
const CONCURRENCY = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 2);

console.log('媒体加载性能基线测量');
console.log('====================');
console.log(`库路径: ${libraryPath}`);
console.log(`图片总数: ${files.length}, 采样: ${sample.length}`);
console.log('硬件配置:');
console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
console.log(`  逻辑核心: ${os.cpus().length}, 可用并行度: ${os.availableParallelism?.() ?? 'n/a'} (sharp.concurrency=${CONCURRENCY})`);
console.log(`  总内存: ${(os.totalmem() / 1073741824).toFixed(1)} GB`);
console.log();
console.log('⚠️ 若使用 test-library（合成小图），各绝对 KB 会偏小；百分比/比率为相对量，真实照片库下更具代表性。');
console.log();

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function fmtKB(bytes) {
  return (bytes / 1024).toFixed(1);
}

// ─── A/B/C：一次遍历同时采集 WebP、JPEG 尺寸，并测吞吐 + RSS 峰值 ───
async function generateThumbs() {
  sharp.concurrency(CONCURRENCY);
  const webpSizes = [];
  const jpegSizes = [];
  let peakRSS = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRSS) peakRSS = rss;
  }, 20);

  const t0 = process.hrtime.bigint();
  for (const f of sample) {
    // 与 image-service sharp 管道一致：resize(inside) + 格式输出
    const webp = await sharp(f).rotate().resize({ width: THUMB_WIDTH, height: THUMB_WIDTH * 2, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY }).toBuffer();
    const jpeg = await sharp(f).rotate().resize({ width: THUMB_WIDTH, height: THUMB_WIDTH * 2, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    webpSizes.push(webp.length);
    jpegSizes.push(jpeg.length);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  clearInterval(sampler);
  return { webpSizes, jpegSizes, ms, peakRSS, baseRSS: process.memoryUsage().rss };
}

const { webpSizes, jpegSizes, ms, peakRSS } = await generateThumbs();
const avgWebp = avg(webpSizes);
const avgJpeg = avg(jpegSizes);

// ─── A. WebP vs JPEG（P2-1 决策）───
console.log('=== A. 缩略图编码格式体积（P2-1 决策依据）===');
console.log(`  平均 WebP(q${WEBP_QUALITY}): ${fmtKB(avgWebp)} KB`);
console.log(`  平均 JPEG(q${JPEG_QUALITY}): ${fmtKB(avgJpeg)} KB`);
const webpSaving = (1 - avgWebp / avgJpeg) * 100;
console.log(`  WebP 相对 JPEG: ${webpSaving >= 0 ? '省' : '多'} ${Math.abs(webpSaving).toFixed(1)}%`);
console.log(`  结论提示: ${webpSaving >= 15 ? '✅ 体积差 ≥15%，P2-1（存量转 WebP）值得做' : '⚠️ 体积差 <15%，P2-1 收益有限，维持现状'}`);
console.log();

// ─── B. base64 / data:URL vs Uint8Array（P0-1 收益）───
// V8 中 base64 为 1 字节/字符的 one-byte string；data:URL 前缀约 22 字节 + mime。
console.log('=== B. 出口编码内存膨胀（P0-1：data:URL → Uint8Array）===');
const base64Len = avgWebp * 4 / 3;              // base64 字符数
const dataUrlLen = base64Len + 22 + 'data:image/webp;base64,'.length; // 前缀 + mime 近似
console.log(`  原始 WebP (Uint8Array): ${fmtKB(avgWebp)} KB`);
console.log(`  base64 字符串:          ${fmtKB(base64Len)} KB（+${((base64Len / avgWebp - 1) * 100).toFixed(0)}%）`);
console.log(`  data:URL 字符串:        ${fmtKB(dataUrlLen)} KB`);
console.log(`  单张缓存项节省:         ${fmtKB(dataUrlLen - avgWebp)} KB`);
const lruCapacityKB = 150 * 1024; // cache.ts MAX_MEMORY_SIZE = 150MB
console.log(`  150MB LRU 可容纳: base64≈${Math.floor(lruCapacityKB / (dataUrlLen / 1024))} 张 vs Uint8Array≈${Math.floor(lruCapacityKB / (avgWebp / 1024))} 张`);
console.log();

// ─── C. 批量生成吞吐 + RSS 峰值（P1-2 验证）───
console.log('=== C. 批量生成吞吐 + 进程 RSS 峰值（P1-2 限流验证）===');
console.log(`  生成 ${sample.length} 张（双格式）耗时: ${ms.toFixed(0)}ms`);
console.log(`  吞吐: ${(sample.length / (ms / 1000)).toFixed(1)} 张/秒（双格式）`);
console.log(`  单格式均值: ${(ms / 2 / sample.length).toFixed(1)}ms/张`);
console.log(`  采样期间进程 RSS 峰值: ${(peakRSS / 1048576).toFixed(1)} MB`);
const RSS_GATE = 800; // scanner.ts 已在 >1.2GB 暂停；此处以 800MB 作为生成侧告警线
console.log(`  结论提示: ${peakRSS / 1048576 < RSS_GATE ? `✅ RSS 峰值 < ${RSS_GATE}MB，生成侧未失控` : `⚠️ RSS 峰值偏高，复核 sharp.concurrency / ffmpeg 信号量`}`);
console.log();

// ─── D. LRU 命中率模拟（cache.ts 同款：Map + 字节预算）───
console.log('=== D. LRU 缓存命中率模拟（目标 ≥70%）===');
function simulateLRU(thumbBytes, maxBytes, pattern) {
  const cache = new Map(); // key -> size；Map 保持插入序，set 重排模拟 LRU
  const seen = new Set();  // 是否首次访问（冷启动 miss 不计入重复浏览口径）
  let hits = 0, misses = 0, coldMisses = 0, evictions = 0, cur = 0;
  for (const key of pattern) {
    const firstTouch = !seen.has(key);
    if (cache.has(key)) {
      // touch
      const sz = cache.get(key);
      cache.delete(key);
      cache.set(key, sz);
      hits++;
    } else {
      misses++;
      if (firstTouch) coldMisses++;
      seen.add(key);
      cache.set(key, thumbBytes);
      cur += thumbBytes;
      while (cur > maxBytes && cache.size > 0) {
        const oldest = cache.keys().next().value;
        cur -= cache.get(oldest);
        cache.delete(oldest);
        evictions++;
      }
    }
  }
  const total = hits + misses;
  const repeats = total - coldMisses;            // 重复访问次数（排除每键首次必 miss）
  const warmHitRate = repeats > 0 ? hits / repeats : 0; // 同数据重复浏览命中率（计划口径）
  return { totalHitRate: total ? hits / total : 0, warmHitRate, hits, misses, coldMisses, repeats, evictions };
}

// 浏览模式：500 张缩略图（small 尺寸，按 thumb 字节近似缩放），
// 线性前滚 + 20% 随机回访 + 3 次筛选切换（重复浏览同一子集）
function buildPattern(n) {
  const pattern = [];
  for (let i = 0; i < n; i++) pattern.push(`img-${i}`);            // 首次前滚
  const visits = Math.floor(n * 0.2);
  for (let i = 0; i < visits; i++) pattern.push(`img-${Math.floor(Math.random() * n)}`); // 回访
  for (let round = 0; round < 3; round++) {                          // 筛选切换重看 60% 子集
    for (let i = 0; i < n * 0.6; i++) pattern.push(`img-${i}`);
  }
  return pattern;
}
// small 尺寸字节按线性尺寸近似缩放（thumb=320 → small=160 ≈ 1/4）
const smallBytes = Math.max(1, Math.round(avgWebp / 4));
const pattern = buildPattern(500);
const lru = simulateLRU(smallBytes, 150 * 1024 * 1024, pattern);
console.log(`  模拟 500 图 × ${pattern.length} 次访问，small 缩略图 ≈ ${fmtKB(smallBytes)} KB/张`);
console.log(`  总命中: ${lru.hits} | 总未命中: ${lru.misses}（冷启动 ${lru.coldMisses} + 容量 ${lru.misses - lru.coldMisses}）| 逐出: ${lru.evictions}`);
console.log(`  总命中率: ${(lru.totalHitRate * 100).toFixed(1)}% | 重复浏览命中率(计划口径): ${(lru.warmHitRate * 100).toFixed(1)}%`);
console.log(`  结论提示: ${lru.warmHitRate >= 0.7 ? '✅ 重复浏览命中率达 70% 目标' : `⚠️ 重复浏览命中率 ${(lru.warmHitRate * 100).toFixed(1)}% <70%，${lru.evictions > 0 ? '存在容量逐出，需上调 LRU 容量' : '合成样本无逐出，真实大图库下复核'}`}`);
console.log();

// ─── E. IPC base64 全量 vs media:// URL+缓存 传输量（P0-2 收益）───
console.log('=== E. 同数据重复浏览的传输量对比（P0-2 收益）===');
const N = 500;
const rounds = 3; // 首访 + 2 次重看
// 旧 IPC：每次都要走主→渲染，序列化 data:URL（无浏览器缓存）
const ipcBytes = N * rounds * dataUrlLen;
// 新 media://：首访 = LRU(64KB)命中主进程内存后仍需生成/读DB→协议传输原始 webp 一次；
//   回访命中 Chromium HTTP 缓存(immutable) → 0 传输。此处保守：仅计每轮未命中协议的部分。
//   简化模型：首访传 webp N 次，重看轮 Chromium 缓存命中 → 传 0。
const mediaBytes = N * avgWebp; // 每图仅一次协议传输，后续 HTTP 缓存命中
console.log(`  ${N} 图 × ${rounds} 轮浏览`);
console.log(`  旧 IPC(data:URL): ${(ipcBytes / 1048576).toFixed(1)} MB 序列化/传输`);
console.log(`  新 media://+HTTP缓存: ${(mediaBytes / 1048576).toFixed(1)} MB（重看轮 0 传输）`);
console.log(`  传输/序列化降低: ${((1 - mediaBytes / ipcBytes) * 100).toFixed(1)}%`);
console.log();

console.log('测量完成。阈值判定供 P2（WebP 转换 / WAL）数据驱动决策参考。');
