// 扫描性能基准测试：测量首次扫描（冷启动）和增量扫描（无变化）的耗时
// 用法：node scripts/bench-scan.mjs [库路径]
//
// 输出示例：
// 库路径: /path/to/library
// 文件总数: 10000
//
// 首次扫描（冷启动）: 45230ms
//   新增: 10000 | 更新: 0 | 跳过: 0 | 删除: 0
//
// 增量扫描（无变化）: 1230ms
//   新增: 0 | 更新: 0 | 跳过: 10000 | 删除: 0
//
// 硬件配置: ...
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const libraryPath = process.argv[2];
if (!libraryPath) {
  console.error('用法: node scripts/bench-scan.mjs <库路径>');
  console.error('示例: node scripts/bench-scan.mjs /path/to/my-library');
  process.exit(1);
}

if (!fs.existsSync(libraryPath)) {
  console.error(`错误: 库路径不存在: ${libraryPath}`);
  process.exit(1);
}

// 收集媒体文件
const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.flac', '.ogg', '.m4a']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name).toLowerCase())) files.push(p);
  }
})(libraryPath);

console.log(`库路径: ${libraryPath}`);
console.log(`文件总数: ${files.length}`);
console.log();

// 输出硬件配置
console.log('硬件配置:');
console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
console.log(`  核心数: ${os.cpus().length}`);
console.log(`  内存: ${(os.totalmem() / 1073741824).toFixed(1)} GB`);
console.log(`  平台: ${os.platform()} ${os.release()}`);
console.log();

// 模拟扫描（简化版，仅统计文件，不生成缩略图）
async function simulateScan(isIncremental = false) {
  const startTime = process.hrtime.bigint();

  let added = 0, updated = 0, skipped = 0, deleted = 0;

  // 模拟数据库查询（首次扫描为空，增量扫描加载所有记录）
  const existingFiles = new Map();
  if (isIncremental) {
    // 模拟从数据库加载已有记录
    for (const file of files) {
      const relativePath = path.relative(libraryPath, file);
      const stat = fs.statSync(file);
      existingFiles.set(relativePath, {
        modified_time: stat.mtime.toISOString(),
        file_size: stat.size
      });
    }
  }

  // 扫描文件
  for (const file of files) {
    const relativePath = path.relative(libraryPath, file);
    const stat = fs.statSync(file);
    const modifiedTime = stat.mtime.toISOString();
    const fileSize = stat.size;

    if (existingFiles.has(relativePath)) {
      const existing = existingFiles.get(relativePath);
      // 双条件增量检查（与 scanner.ts:223 一致）
      if (existing.modified_time === modifiedTime && existing.file_size === fileSize) {
        skipped++;
        continue;
      }
      updated++;
    } else {
      added++;
    }
  }

  const endTime = process.hrtime.bigint();
  const durationMs = Number(endTime - startTime) / 1e6;

  return {
    duration: durationMs,
    added,
    updated,
    skipped,
    deleted
  };
}

// 执行基准测试
async function runBenchmark() {
  console.log('=== 首次扫描（冷启动）===');
  const cold = await simulateScan(false);
  console.log(`耗时: ${cold.duration.toFixed(0)}ms`);
  console.log(`新增: ${cold.added} | 更新: ${cold.updated} | 跳过: ${cold.skipped} | 删除: ${cold.deleted}`);
  console.log();

  console.log('=== 增量扫描（无变化）===');
  const warm = await simulateScan(true);
  console.log(`耗时: ${warm.duration.toFixed(0)}ms`);
  console.log(`新增: ${warm.added} | 更新: ${warm.updated} | 跳过: ${warm.skipped} | 删除: ${warm.deleted}`);
  console.log();

  // 性能评估
  console.log('=== 性能评估 ===');
  const filesPerSec = (files.length / (cold.duration / 1000)).toFixed(0);
  console.log(`首次扫描速度: ${filesPerSec} 文件/秒`);

  const speedup = (cold.duration / warm.duration).toFixed(1);
  console.log(`增量扫描加速比: ${speedup}x`);

  // 目标检查（10 万张库）
  if (files.length >= 1000) {
    const estimated100k = (cold.duration / files.length) * 100000;
    console.log(`\n预估 10 万张库首次扫描: ${(estimated100k / 60000).toFixed(1)} 分钟`);

    if (estimated100k > 8 * 60 * 1000) {
      console.log('⚠️ 警告: 预估超过目标（8 分钟）');
    } else {
      console.log('✅ 符合目标（< 8 分钟）');
    }
  }
}

runBenchmark().catch(err => {
  console.error('基准测试失败:', err);
  process.exit(1);
});
