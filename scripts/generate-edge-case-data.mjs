// 边界与异常测试数据生成器（M-A 准备项，见 docs/plans/全面测试方案-2026-09-19.md §3）
// 用法：
//   node scripts/generate-edge-case-data.mjs [输出目录] [--big-video]
//   默认输出到 test-library-edge/（已加入 .gitignore，不入库）
//   --big-video：额外生成一个 >1GB 的有效 mp4（用于 MT-MEDIA-05 视频 seek），耗时/占磁盘较大，默认关闭
// 依赖：sharp（图片）、ffmpeg-static（音视频），均为项目现有依赖。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('--'))
const positional = args.filter((a) => !a.startsWith('--'))
const OUT = positional[0] || 'test-library-edge'
const WANT_BIG = flags.includes('--big-video')

const ok = []
const fail = []
const pending = []
function attempt(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      pending.push(
        r.then(
          () => { ok.push(name); console.log(`  ✓ ${name}`) },
          (e) => { fail.push([name, e.message]); console.error(`  ✗ ${name}: ${e.message}`) },
        ),
      )
    } else {
      ok.push(name)
      console.log(`  ✓ ${name}`)
    }
  } catch (e) {
    fail.push([name, e.message])
    console.error(`  ✗ ${name}: ${e.message}`)
  }
}

function dir(sub) {
  const p = path.join(OUT, sub)
  fs.mkdirSync(p, { recursive: true })
  return p
}

// 生成一张有效 JPEG（返回 buffer）
async function jpegBuffer(w = 640, h = 480, color = { r: 120, g: 80, b: 200 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 85 })
    .toBuffer()
}

function runFfmpeg(ffArgs) {
  const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...ffArgs], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${r.stderr || r.stdout || r.status}`)
}

async function main() {
  console.log(`[edge-data] 输出目录: ${OUT}（big-video=${WANT_BIG}）`)
  fs.mkdirSync(OUT, { recursive: true })

  // 0) 有效基线图片（供正常链路对照）
  const valid = dir('00-valid')
  for (let i = 0; i < 3; i++) {
    const buf = await jpegBuffer(640, 480, { r: 40 + i * 60, g: 90, b: 160 - i * 40 })
    attempt(`有效图片 img-${i + 1}.jpg`, () => fs.writeFileSync(path.join(valid, `img-${i + 1}.jpg`), buf))
  }

  // 1) 损坏 JPEG（截断）
  const corrupt = dir('01-corrupt')
  attempt('损坏图片 corrupted.jpg（截断至 40%）', async () => {
    const buf = await jpegBuffer(640, 480)
    fs.writeFileSync(path.join(corrupt, 'corrupted.jpg'), buf.subarray(0, Math.floor(buf.length * 0.4)))
  })

  // 2) 0 字节文件
  const empty = dir('02-empty')
  attempt('空文件 empty.jpg（0 字节）', () => fs.writeFileSync(path.join(empty, 'empty.jpg'), Buffer.alloc(0)))

  // 3) 伪扩展名（文本内容改 .jpg）+ 无扩展名
  const fake = dir('03-fake-extension')
  attempt('伪扩展名 not-an-image.jpg（实为文本）', () =>
    fs.writeFileSync(path.join(fake, 'not-an-image.jpg'), 'this is plain text, not a jpeg'))
  attempt('无扩展名文件 no_extension（实为 JPEG）', async () => {
    const buf = await jpegBuffer(320, 240, { r: 200, g: 200, b: 0 })
    fs.writeFileSync(path.join(fake, 'no_extension'), buf)
  })

  // 4) 不支持格式（DEF-2 复验：伪 avi/mkv）
  const unsup = dir('04-unsupported')
  attempt('不支持格式 broken.avi（伪头）', () =>
    fs.writeFileSync(path.join(unsup, 'broken.avi'), Buffer.from('RIFF\x00\x00\x00\x00AVI LIST', 'binary')))
  attempt('不支持格式 broken.mkv（伪头）', () =>
    fs.writeFileSync(path.join(unsup, 'broken.mkv'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))

  // 5) 特殊字符文件名
  const special = dir('05-special-names')
  const specialNames = ['中文 图片 名称.jpg', '带 空格 和 括号 (1).jpg', "quote'and&hash#.jpg", '长'.repeat(60) + '.jpg']
  for (const nm of specialNames) {
    attempt(`特殊文件名 ${nm}`, async () => {
      const buf = await jpegBuffer(320, 240, { r: 80, g: 160, b: 80 })
      fs.writeFileSync(path.join(special, nm), buf)
    })
  }

  // 6) 长文件名 + 深层长路径（fs 层预期成功，sharp/ffmpeg 层预期降级；执行机需 git config core.longpaths true）
  const longName = 'longname_'.repeat(20) + '.jpg' // ~145 字符
  attempt(`长文件名（${longName.length} 字符）`, async () => {
    const buf = await jpegBuffer(320, 240, { r: 160, g: 80, b: 160 })
    fs.writeFileSync(path.join(special, longName), buf)
  })
  attempt('深层长路径（多级嵌套累计 ~250 字符）', async () => {
    let deep = path.join(OUT, '06-long-path')
    fs.mkdirSync(deep, { recursive: true })
    for (let i = 0; i < 8; i++) {
      deep = path.join(deep, `nested-directory-level-${i}-aaaaaaaaaaaa`)
      fs.mkdirSync(deep, { recursive: true })
    }
    const buf = await jpegBuffer(320, 240, { r: 20, g: 200, b: 200 })
    fs.writeFileSync(path.join(deep, 'deep-file.jpg'), buf)
  })

  // 7) 音视频（有效小文件，供 MT-MEDIA-01/05、DEF-2、音频 wavesurfer）
  const av = dir('07-audio-video')
  attempt('有效视频 small.mp4（2s testsrc）', () =>
    runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=25', '-pix_fmt', 'yuv420p', path.join(av, 'small.mp4')]))
  attempt('有效音频 tone.wav（2s 440Hz）', () =>
    runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', path.join(av, 'tone.wav')]))
  attempt('有效音频 tone.mp3（2s 440Hz）', () =>
    runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-codec:a', 'libmp3lame', path.join(av, 'tone.mp3')]))
  attempt('视频伪扩展名 video-as-.txt.mp4（内容损坏）', () =>
    fs.writeFileSync(path.join(av, 'video-as-.txt.mp4'), 'not really mp4'))

  if (WANT_BIG) {
    attempt('>1GB 大视频 big.mp4（高码率 base + concat 拷贝）', () => {
      const base = path.join(av, '_base.mp4')
      // 10s @ ~120Mbps → ~150MB
      runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=10:size=1920x1080:rate=30', '-pix_fmt', 'yuv420p', '-b:v', '120M', base])
      // concat 拷贝至 >1GB（≈8x=1.2GB），stream copy 快
      const list = path.join(av, '_list.txt')
      const N = 8
      fs.writeFileSync(
        list,
        Array.from({ length: N }, () => `file '${base.replace(/'/g, "'\\''")}'`).join('\n'),
      )
      runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(av, 'big.mp4')])
      fs.rmSync(base)
      fs.rmSync(list)
    })
  } else {
    console.log('  · 跳过大视频（加 --big-video 生成 >1GB 有效 mp4）')
  }

  // 8) 真实人物照片占位（matting L3 验收需真人照片，脚本无法生成 → 标 BLOCKED 等素材）
  const person = dir('08-person-real')
  attempt('真人照片目录 README（matting 验收需人工补拍，见方案 L3/BLOCKED-等素材）', () =>
    fs.writeFileSync(
      path.join(person, 'README.txt'),
      '此目录需放入真实含主体（人物）照片用于 Phase8 §2 / L3 matting 抠图质量验收。\n自动化只能生成无主体图，无法验证抠图边缘质量。\n',
    ))

  await Promise.all(pending)
  console.log(`\n[edge-data] 完成：成功 ${ok.length}，失败 ${fail.length}`)
  if (fail.length) {
    console.log('失败项（多为环境/权限所致，不阻塞其余数据）：')
    for (const [n, m] of fail) console.log(`  - ${n}: ${m}`)
  }
}

main().catch((e) => {
  console.error('[edge-data] 致命错误:', e)
  process.exit(1)
})
