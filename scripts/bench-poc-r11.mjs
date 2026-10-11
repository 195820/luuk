// R11 PoC（Tier1-B）：1M × 512 int8 随机向量下 HNSW（USearch）召回/延迟网格扫描
// 裁决问题（方向文档 §15 D14 失效判据 / §9.4 一期目标）：
//   「默认 HNSW 参数（M=16/efC=128/efS=64）在 1M×512 int8 上是否满足 1-recall@10 ≥ 0.95 且 P95 ≤ 1s？」
// 不达标 → D14 触发回退 sqlite-vec（本脚本产出裁决数据，回退实施待用户拍板）。
//
// 口径声明（务必读）：
//   1) 向量取 crypto.randomBytes → Int8Array 有符号视图（与 bench-poc-r5.mjs / randVec() 同源）。
//      **随机向量是 HNSW 最坏情况**（无簇结构、图导航最难），测得为召回/延迟下界；真实 CLIP 向量有簇结构通常更好。
//   2) groundtruth = 分块暴力扫描按**余弦相似度**取每 query 真实 top-10（浮点精确、int8 数值口径，
//      等同生产 sqlite-vec/暴力扫描的「精确」参照）。实测确认 usearch i8-cosine 与浮点余弦在小规模完全一致
//      （无 int8 溢出），因此 recall 偏低纯为 HNSW 图在对抗性随机高维数据上的导航极限，非度量 bug。
//   3) 1-recall@10 采用 **hit-rate 口径**：|ANN_top10 ∩ GT_top10| / 10（与 intersection 口径区分）。
//   4) 延迟：QUERIES 次查询各自 performance.now()，取 P50/P95。
//   5) recallCeiling：max-ef 组（ef=rows）对浮点 GT 的召回——反映 HNSW 图可达上限（随机数据常 <1）。
//
// 用法：
//   node scripts/bench-poc-r11.mjs [--rows=1000000] [--dim=512] [--queries=50] [--k=10] [--grid=full|reduced] [--keep]
//   · --rows=10000  快速验证脚本正确性（recall 随 ef 递增；ceiling 反映随机数据图极限）
//   · --rows=1000000 完整裁决（8 组网格，构建每组单列 ETA）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { Index } from 'usearch'

const require = createRequire(import.meta.url)
const argStr = (name, dft) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dft
}
const arg = (name, dft) => Number(argStr(name, dft))
const ROWS = arg('rows', 1_000_000)
const DIM = arg('dim', 512)
const QUERIES = arg('queries', 50)
const K = arg('k', 10)
const DTYPE = argStr('dtype', 'i8') // i8 | f32；f32 用于对照实验（排除 int8 度量/溢出因素，见 §B.1 脚本正确性判据）
const KEEP = process.argv.includes('--keep')
// 1M 用降网格（8 组），小规模用全网格（27 组）；--grid 可显式覆盖
const REDUCED = argStr('grid', ROWS >= 1_000_000 ? 'reduced' : 'full') === 'reduced'
const GRID_M = REDUCED ? [16, 32] : [8, 16, 32]
const GRID_EFC = REDUCED ? [128, 256] : [64, 128, 256]
const GRID_EFS = REDUCED ? [64, 128] : [16, 64, 128]
const OUT_DIR = path.join('scripts', 'poc-r11')
const OUT_FILE = path.join(OUT_DIR, DTYPE === 'i8' ? `result-r11-${ROWS}.json` : `result-r11-${ROWS}-${DTYPE}.json`)
const readUsearchVersion = () => { try { return JSON.parse(fs.readFileSync(path.join('node_modules', 'usearch', 'package.json'), 'utf8')).version } catch { return 'unknown' } }

const fmtMB = (b) => Math.round(b / 1048576)
const rssMB = () => fmtMB(process.memoryUsage().rss)
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1)]

// ── 阶段 1：生成 int8 语料（单块 flat buffer，零拷贝 Int8Array 视图）+ 预算每向量范数 ──
function genCorpus(n) {
  const buf = crypto.randomBytes(n * DIM) // Uint8Array(0..255)
  const i8 = new Int8Array(buf.buffer, buf.byteOffset, n * DIM) // 有符号视图（与 R5 / usearch i8 一致）
  const f32 = DTYPE === 'f32' ? Float32Array.from(i8) : null // 对照实验：同数值 f32 索引，排除 int8 内核度量差
  const norms = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    let s = 0
    const base = r * DIM
    for (let d = 0; d < DIM; d++) { const x = i8[base + d]; s += x * x }
    norms[r] = Math.sqrt(s)
  }
  return { i8, f32, norms }
}

// ── 阶段 2：暴力扫描 groundtruth（浮点精确余弦 top-K，等同生产精确参照）──
function computeGroundtruth(corpus, queries) {
  const { i8, norms } = corpus
  const gts = []
  for (const q of queries) {
    const top = []
    let minCos = -Infinity
    for (let r = 0; r < ROWS; r++) {
      const base = r * DIM
      let dot = 0
      for (let d = 0; d < DIM; d++) dot += i8[base + d] * q.vec[d]
      const cos = dot / (q.norm * (norms[r] || 1))
      if (top.length < K) {
        top.push({ id: r, cos })
        if (top.length === K) { top.sort((a, b) => b.cos - a.cos); minCos = top[K - 1].cos }
      } else if (cos > minCos) {
        top[K - 1] = { id: r, cos }
        top.sort((a, b) => b.cos - a.cos); minCos = top[K - 1].cos
      }
    }
    gts.push(new Set(top.map((t) => t.id)))
  }
  return gts
}

// ── 阶段 3：单组配置 build + query + recall（efSearchOverride 用于 ceiling 诊断）──
function runConfig(corpus, queries, gts, M, efC, efS, efSearchOverride) {
  const t0 = Date.now()
  const rssBefore = process.memoryUsage().rss
  // usearch 2.26.2 实测：对象构造用 dimensions 键；connectivity/expansion_* 生效；search 第 3 参是 threads 非 ef
  const index = new Index({
    dimensions: DIM, metric: 'cos', quantization: DTYPE,
    connectivity: M, expansion_add: efC, expansion_search: efS,
  })
  const src = corpus.f32 ?? corpus.i8 // DTYPE=f32 走 Float32Array，=i8 走 Int8Array
  for (let r = 0; r < ROWS; r++) index.add(BigInt(r), src.subarray(r * DIM, (r + 1) * DIM))
  const buildMs = Date.now() - t0
  const buildRssDeltaMB = fmtMB(process.memoryUsage().rss - rssBefore)

  const ef = efSearchOverride ?? efS
  index.expansion_search = ef // 搜索期 ef 经属性控制
  const lat = []
  let hitSum = 0
  for (let qi = 0; qi < queries.length; qi++) {
    const qs = performance.now()
    const m = index.search(queries[qi].vec, K, 0)
    lat.push(performance.now() - qs)
    let hit = 0
    for (let i = 0; i < m.keys.length; i++) if (Number.isFinite(m.distances[i]) && gts[qi].has(Number(m.keys[i]))) hit++
    hitSum += hit / K
  }
  const recall = hitSum / queries.length
  lat.sort((a, b) => a - b)
  const p50 = pct(lat, 50), p95 = pct(lat, 95)
  const qps = Math.round(1000 / (lat.reduce((s, x) => s + x, 0) / lat.length))
  // 无显式 free/delete API（usearch 2.26.2 实测）：函数返回后局部引用耗尽 → GC 触发原生析构释放
  return {
    M, efC, efS, buildSec: Math.round(buildMs / 1000), buildMs, buildRssDeltaMB, peakRssMB: rssMB(),
    recallAt10: Number(recall.toFixed(4)),
    queryP50Ms: Number(p50.toFixed(2)), queryP95Ms: Number(p95.toFixed(2)), qps,
    pass: recall >= 0.95 && p95 <= 1000,
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const configs = []
  for (const M of GRID_M) for (const efC of GRID_EFC) for (const efS of GRID_EFS) configs.push([M, efC, efS])
  const results = {
    meta: {
      rows: ROWS, dim: DIM, queries: QUERIES, k: K, quant: DTYPE, metric: 'cos',
      grid: REDUCED ? 'reduced(8)' : 'full(27)', configs: configs.length,
      usearch: readUsearchVersion(),
      recallCaliber: 'hit-rate: |ANN∩GT|/K',
      gtCaliber: 'float-exact cosine top-K over int8 vectors（= 生产暴力扫描/sqlite-vec 精确参照）',
      note: '随机向量=HNSW 最坏情况下界；真实 CLIP 向量有簇结构通常更好。可加 --from-db 复测真实向量（待实现）',
      startAt: new Date().toISOString(),
    },
    perConfig: [],
  }

  console.log(`[R11] rows=${ROWS} dim=${DIM} queries=${QUERIES} grid=${results.meta.grid} (${configs.length} 组)`)
  const corpus = genCorpus(ROWS)
  console.log(`[R11] 语料生成完成，RSS=${rssMB()}MB`)
  const queries = []
  for (let i = 0; i < QUERIES; i++) {
    const b = crypto.randomBytes(DIM)
    const i8v = new Int8Array(b.buffer, b.byteOffset, DIM) // 带 byteOffset，不依赖 randomBytes 是否走 Buffer pool
    let s = 0
    for (let d = 0; d < DIM; d++) s += i8v[d] * i8v[d]
    queries.push({ vec: DTYPE === 'f32' ? Float32Array.from(i8v) : i8v, norm: Math.sqrt(s) || 1 })
  }
  console.log(`[R11] 计算 groundtruth（浮点暴力余弦扫描 ${ROWS}×${QUERIES}）...`)
  const gtT0 = Date.now()
  const gts = computeGroundtruth(corpus, queries)
  console.log(`[R11] groundtruth 完成，耗时 ${Math.round((Date.now() - gtT0) / 1000)}s，RSS=${rssMB()}MB`)

  for (let i = 0; i < configs.length; i++) {
    const [M, efC, efS] = configs[i]
    process.stdout.write(`[R11] (${i + 1}/${configs.length}) M=${M} efC=${efC} efS=${efS} 构建中... `)
    const r = runConfig(corpus, queries, gts, M, efC, efS)
    process.stdout.write(`build=${(r.buildMs / 1000).toFixed(1)}s recall@10=${r.recallAt10} P95=${r.queryP95Ms}ms pass=${r.pass}\n`)
    results.perConfig.push(r)
    if (KEEP) fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2)) // 边跑边落盘，可中断
  }

  // 召回上限诊断：最高 M/efC 组以 ef=rows 穷举搜索，反映 HNSW 图可达上限（随机数据常 <1）
  const [cM, cefC] = [GRID_M[GRID_M.length - 1], GRID_EFC[GRID_EFC.length - 1]]
  const ceil = runConfig(corpus, queries, gts, cM, cefC, ROWS, ROWS)
  results.recallCeiling = { M: cM, efC: cefC, ef: ROWS, recallAt10: ceil.recallAt10, queryP95Ms: ceil.queryP95Ms }
  console.log(`[R11] 召回上限(ef=rows 穷举 M=${cM}/efC=${cefC})：recall@10=${ceil.recallAt10} P95=${ceil.queryP95Ms}ms`)

  const passers = results.perConfig.filter((c) => c.pass)
  const best = [...results.perConfig].sort((a, b) => (b.recallAt10 - a.recallAt10) || (a.queryP95Ms - b.queryP95Ms))[0]
  results.verdict = passers.length > 0
    ? { result: '达标', note: `存在 ${passers.length} 组满足 recall≥0.95 且 P95≤1s`, bestParamPass: passers.sort((a, b) => a.queryP95Ms - b.queryP95Ms)[0] }
    : (ceil.recallAt10 < 0.95
      ? { result: '不达标', note: `无一组满足，且 ef=rows 穷举上限 recall=${ceil.recallAt10} < 0.95 → 纯随机数据下 HNSW 图导航不可达标（D14 触发；但真实 CLIP 向量应更好，需 --from-db 复测）`, best }
      : (best.recallAt10 >= 0.95
        ? { result: '部分达标', note: 'recall 达标但延迟超标，需用户拍板精度 vs 体感取舍', best }
        : { result: '部分达标', note: '延迟达标但 recall 不足（ceiling 内），需用户拍板或调参', best }))
  results.meta.endAt = new Date().toISOString()
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2))

  console.log('\n=== R11 裁决 ===')
  console.log(`${results.verdict.result} — ${results.verdict.note}`)
  console.log(`最优/达标组：${JSON.stringify(results.verdict.bestParamPass || results.verdict.best)}`)
  console.log(`结果落盘：${OUT_FILE}`)
}

main()
