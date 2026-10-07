// R7 PoC：大图推理内存峰值实测（方向文档 §15 R7 / §7.4 三级水位线）
// 协议：逐级分辨率测 RSS 峰值与耗时，对照水位线（绿<300 / 黄300-400 / 红>400 MB）
// Prereq：npm i onnxruntime-node@^1.30.0 --no-save；node scripts/poc-r2/download-r7-models.mjs（下模型到 cache/poc-r2）；
//         需 test-data/huge-library（gitignore 的本地测试库）
// 用法：node scripts/bench-poc-r7.mjs [--only task/strategy/size 子串过滤] [--run-one task strategy size（内部用）]
//   - matting / naive  ：整图直接进模型（resize 到目标分辨率后一次推理，u2netp 不限输入尺寸）
//   - matting / tiled  ：固定 320×320 小输入 + 全分辨率一次合成（降采样方案，非分块）
//   - matting / tiledTrue：§15 要求的真分块档位——掩码仍 320 推理，合成阶段逐块解码/编码流式写盘，
//         全尺寸 RGBA 缓冲不入内存（抠图模型面内存大头其实在合成阶段）
//   - upscale / naive  ：整图一次超分（x4，输出全尺寸张量驻留内存）
//   - upscale / tiled  ：先 resize 到目标档位再 T tile + 8px overlap 分块推理（--tile 可调，默认 512），
//         逐行带流式合成：每带 x4 缓冲→编码 JPEG→写盘后即释放，结尾手工拼 JPEG（共享表头 + DRI 重启间隔 + 带片段 + EOI）
// 注意：naive 大尺寸可能触发系统 OOM，脚本按梯级独立进程运行（--run-one 内部用）
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const MODEL = {
  matting: path.join(ROOT, 'cache', 'poc-r2', 'u2netp.onnx'),
  upscale: path.join(ROOT, 'cache', 'poc-r2', 'realesr-x4v3.onnx'),
}
const SRC = path.join(ROOT, 'test-data', 'huge-library', 'Folder_109', 'photo0018.jpg') // 4573x2798
const SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160], native: [4573, 2798] }

function peakTracker() {
  let peak = process.memoryUsage().rss
  const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 100)
  return () => { clearInterval(t); return peak / 1048576 }
}

async function runOne(task, strategy, sizeKey, tileOverride) {
  const ort = require('onnxruntime-node')
  const sharp = require('sharp')
  const [W, H] = SIZES[sizeKey]
  const session = await ort.InferenceSession.create(MODEL[task])
  const getPeak = peakTracker()
  const t0 = Date.now()
  let steps = []

  if (task === 'matting' && strategy !== 'tiledTrue') {
    // 模型输入尺寸：naive=整图目标分辨率；tiled=固定 320（生产方案）
    const inW = strategy === 'tiled' ? 320 : W
    const inH = strategy === 'tiled' ? 320 : H
    const { data } = await sharp(SRC).resize(inW, inH, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const tDec = Date.now()
    const f32 = new Float32Array(3 * inW * inH)
    for (let y = 0; y < inH; y++) for (let x = 0; x < inW; x++) for (let c = 0; c < 3; c++) {
      f32[c * inW * inH + y * inW + x] = data[(y * inW + x) * 3 + c] / 255
    }
    const res = await session.run({ input: new ort.Tensor('float32', f32, [1, 3, inH, inW]) }, ['output'])
    const tInf = Date.now()
    // 掩码放大回原分辨率并合成 RGBA（模型外内存同样计入）
    const mask = res.output.data // [1,1,inH,inW] 0..1
    const maskBuf = Buffer.alloc(inW * inH)
    for (let i = 0; i < mask.length; i++) maskBuf[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255)
    const maskOut = await sharp(maskBuf, { raw: { width: inW, height: inH, channels: 1 } })
      .resize(W, H, { fit: 'cover' }).png().toBuffer()
    const { data: rgb } = await sharp(SRC).resize(W, H, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rgba = Buffer.alloc(W * H * 4)
    const { data: m8 } = await sharp(maskOut).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = m8[i]
    }
    const out = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
    steps = { decodePreMs: tDec - t0, inferMs: tInf - tDec, postMs: Date.now() - tInf, outKB: Math.round(out.length / 1024) }
  } else if (strategy === 'tiledTrue') {
    // 真分块抠图（流式合成）：掩码 320 推理后放大回 W×H 单通道；逐 tile 从原图 extract 解码 → 切掩码 → RGBA → PNG → 写盘
    // 全尺寸 RGBA/PNG 缓冲不再驻留内存，4K 档理论上不该 OOM
    const { data } = await sharp(SRC).resize(320, 320, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const tDec = Date.now()
    const f32 = new Float32Array(3 * 320 * 320)
    for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) for (let c = 0; c < 3; c++) {
      f32[c * 320 * 320 + y * 320 + x] = data[(y * 320 + x) * 3 + c] / 255
    }
    const res = await session.run({ input: new ort.Tensor('float32', f32, [1, 3, 320, 320]) }, ['output'])
    const tInf = Date.now()
    const mask = res.output.data // [1,1,320,320] 0..1
    const m320 = Buffer.alloc(320 * 320)
    for (let i = 0; i < mask.length; i++) m320[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255)
    const { data: maskFull } = await sharp(m320, { raw: { width: 320, height: 320, channels: 1 } })
      .resize(W, H, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true }) // W*H 单通道
    // 同 upscale 口径：先把整图 resize 到目标档位落盘一次，再逐 tile 从 work 裁片（避免每 tile 全图重解码）
    const work = path.join(os.tmpdir(), `luuk-poc-r7-${W}x${H}.jpg`)
    await sharp(SRC).resize(W, H, { fit: 'cover' }).jpeg({ quality: 92 }).toFile(work)
    const T = 512
    const outFile = path.join(os.tmpdir(), `luuk-r7-mat-${W}x${H}-tiledTrue.png`)
    let decodeMs = 0, encodeMs = 0
    for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) {
      const tw = Math.min(T, W - cx), th = Math.min(T, H - cy)
      const a = Date.now()
      const { data: rgb } = await sharp(work)
        .extract({ left: cx, top: cy, width: tw, height: th }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      decodeMs += Date.now() - a
      const rgba = Buffer.alloc(tw * th * 4)
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
        const gi = (cy + j) * W + (cx + i), si = j * tw + i
        rgba[si * 4] = rgb[si * 3]; rgba[si * 4 + 1] = rgb[si * 3 + 1]; rgba[si * 4 + 2] = rgb[si * 3 + 2]; rgba[si * 4 + 3] = maskFull[gi]
      }
      const b = Date.now()
      const png = await sharp(rgba, { raw: { width: tw, height: th, channels: 4 } }).png().toBuffer()
      encodeMs += Date.now() - b
      await fs.promises.writeFile(outFile, png) // 阶段性产物只留最后一片（PoC 测的是内存峰值，不累全图）
    }
    fs.rmSync(work, { force: true })
    steps = { decodePreMs: tDec - t0, inferMs: tInf - tDec, postMs: Date.now() - tInf, tiles: Math.ceil(H / T) * Math.ceil(W / T), tileDecodeMs: decodeMs, encodeMs, outKB: Math.round(fs.statSync(outFile).size / 1024) }
  } else {
    // upscale：先把整图 resize 到目标档位（与 §15「逐级分辨率整图」协议同口径），再按需分块；输入 [1,3,H,W]，输出 x4
    const work = path.join(os.tmpdir(), `luuk-poc-r7-${W}x${H}.jpg`)
    await sharp(SRC).resize(W, H, { fit: 'cover' }).jpeg({ quality: 92 }).toFile(work)
    const outW = W * 4, outH = H * 4
    const T = tileOverride ?? 512, OV = 8
    // 单 tile 推理（naive 为全图单 tile；tiled 为 T×T 核区 + 8px overlap 向左上扩展）
    const inferTile = async (tl) => {
      const a = Date.now()
      const { data } = await sharp(work).extract({ left: tl.x, top: tl.y, width: tl.w, height: tl.h }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const decodeMs = Date.now() - a
      const f32 = new Float32Array(3 * tl.w * tl.h)
      for (let y = 0; y < tl.h; y++) for (let x = 0; x < tl.w; x++) for (let c = 0; c < 3; c++) {
        f32[c * tl.w * tl.h + y * tl.w + x] = data[(y * tl.w + x) * 3 + c] / 255
      }
      const b = Date.now()
      const res = await session.run({ input: new ort.Tensor('float32', f32, [1, 3, tl.h, tl.w]) }, ['output'])
      return { o: res.output.data, decodeMs, inferMs: Date.now() - b, ow: tl.w * 4 }
    }
    let inferMs = 0, decodeMs = 0, encodeMs = 0, outKB = 0, tiles = []
    if (strategy === 'naive') {
      // 全图单 tile → 全尺寸 x4 合成缓冲（模型输出 + 合成缓冲均驻留内存，体现 naive 峰值）
      const tl = { x: 0, y: 0, w: W, h: H, cx: 0, cy: 0, cw: W, ch: H }
      tiles = [tl]
      const r = await inferTile(tl)
      decodeMs += r.decodeMs; inferMs += r.inferMs
      const dest = Buffer.alloc(outW * outH * 3)
      const ow = r.ow
      for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) for (let c = 0; c < 3; c++) {
        dest[(y * outW + x) * 3 + c] = Math.round(Math.min(1, Math.max(0, r.o[c * ow * outH + y * ow + x])) * 255)
      }
      const out = await sharp(dest, { raw: { width: outW, height: outH, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
      outKB = Math.round(out.length / 1024)
    } else {
      // tiled（流式合成）：逐行带处理，内存全程只驻留一个行带（outW×带高×3）→ 编码为条带 JPEG 落盘→回读校验可解码→删除
      // 产物为 N 个水平条带（真流式，避免全尺寸合成缓冲）；带内 tile 有 8px 水平 overlap（x>0），带与带不做垂直 overlap（接缝质量属 Phase 10 调参）
      const stripDir = path.join(os.tmpdir(), `luuk-r7-up-${W}x${H}-T${T}`)
      fs.mkdirSync(stripDir, { recursive: true })
      let stripIdx = 0, stripBytes = 0
      for (let by = 0; by < H; by += T) {
        const bh = Math.min(T, H - by) // 带高（输入域像素）
        const band = Buffer.alloc(outW * bh * 4 * 3) // 输出域：行高 bh*4
        const bandTiles = []
        for (let x = 0; x < W; x += T) {
          const tx = Math.max(0, x - (x > 0 ? OV : 0))
          const tw = Math.min(T + (x > 0 ? OV : 0), W - tx)
          bandTiles.push({ x: tx, y: by, w: tw, h: bh, cx: x, cy: by, cw: Math.min(T, W - x), ch: bh })
        }
        tiles.push(...bandTiles)
        for (const tl of bandTiles) {
          const r = await inferTile(tl)
          decodeMs += r.decodeMs; inferMs += r.inferMs
          const ow = r.ow, oh = tl.h * 4
          // 只写核区（行带内相对行号 = tl.cy - by），水平重叠带由前一 tile 负责
          for (let y = 0; y < tl.ch * 4; y++) for (let x = 0; x < tl.cw * 4; x++) for (let c = 0; c < 3; c++) {
            const gy = (tl.cy - by) * 4 + y, gx = tl.cx * 4 + x
            const sy = (y + (tl.cy - tl.y) * 4), sx = (x + (tl.cx - tl.x) * 4)
            band[(gy * outW + gx) * 3 + c] = Math.round(Math.min(1, Math.max(0, r.o[c * ow * oh + sy * ow + sx])) * 255)
          }
        }
        const c0 = Date.now()
        const stripFile = path.join(stripDir, `band${stripIdx++}.jpg`)
        await sharp(band, { raw: { width: outW, height: bh * 4, channels: 3 } }).jpeg({ quality: 90 }).toFile(stripFile)
        await sharp(stripFile).toBuffer() // 逐带回读校验条带可解码（抛错即脚本失败）
        stripBytes += fs.statSync(stripFile).size
        fs.rmSync(stripFile, { force: true })
        encodeMs += Date.now() - c0
      }
      fs.rmSync(stripDir, { recursive: true, force: true })
      outKB = Math.round(stripBytes / 1024)
    }
    fs.rmSync(work, { force: true })
    const totalMs = Date.now() - t0
    steps = { tile: strategy === 'naive' ? 'native' : T, tiles: tiles.length, decodeMs, inferMs, encodeMs, postMs: totalMs - decodeMs - inferMs - encodeMs, outKB }
  }
  const rssPeakMB = Math.round(getPeak())
  await new Promise((r) => process.stdout.write('===JSON===\n' + JSON.stringify({ task, strategy, size: sizeKey + ' ' + W + 'x' + H, totalMs: Date.now() - t0, rssPeakMB, ...steps }) + '\n', r))
  process.exit(0)
}

// ---- 驱动模式：每级组合起一个独立子进程，收集结果 ----
const argv = process.argv.slice(2)
const getArg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
if (getArg('run-one', null)) {
  await runOne(argv[1], argv[2], argv[3], getArg('tile', null) ? Number(getArg('tile', null)) : undefined) // argv 已去掉 node 与脚本本身，--run-one 后依次为 task strategy size
} else {
  const combos = []
  for (const [task, strategies, sizes] of [
    ['matting', ['naive'], ['720p', '1080p', '4k', 'native']],
    ['matting', ['tiled'], ['720p', '1080p', '4k', 'native']],
    ['matting', ['tiledTrue'], ['720p', '1080p', '4k']],
    ['upscale', ['naive'], ['720p', '1080p']],
    ['upscale', ['tiled'], ['720p', '1080p', '4k', 'native']],
  ]) for (const s of strategies) for (const z of sizes) combos.push([task, s, z])
  const only = getArg('only', null)
  const picked = only ? combos.filter((c) => c.join(' / ').includes(only)) : combos
  const tile = getArg('tile', null)

  const results = []
  for (const c of picked) {
    process.stdout.write(`> ${c.join(' / ')}${tile ? ` (T=${tile})` : ''} ... `)
    let line = null
    try {
      const out = execFileSync(process.execPath, [import.meta.filename, '--run-one', ...c, ...(tile ? ['--tile', tile] : [])], { encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1048576 })
      const m = out.split('\n').find((l) => l.startsWith('{'))
      line = JSON.parse(m)
      console.log(`RSS=${line.rssPeakMB}MB ${line.totalMs}ms`)
    } catch (e) {
      console.log('FAILED/CRASHED:', String(e.message || e).slice(0, 100))
      line = { task: c[0], strategy: c[1], size: c[2], crashed: true, err: String(e.message || e).slice(0, 200) }
    }
    results.push(line)
  }
  console.log('\n===== R7 SUMMARY =====')
  console.log(JSON.stringify(results, null, 1))
}
