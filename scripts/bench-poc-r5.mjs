// R5 PoC（T-7）：1M 条 int8 embedding 入 thumbs.db 的体积 / 语义查询延迟 / EXPLAIN QUERY PLAN
// 协议（方向文档 §15-R5 + §9.2 schema + §9.4 一期检索策略）：
//   1) 按 §9.2 image_embeddings 建表，写入 N 条 512 维 int8 随机向量（事务分批）
//   2) 重开库，测「分块流式暴力扫描 + int8 点积」的查询 P50/P95 与 RSS 峰值（块大小决定内存，非库规模）
//   3) 捕获 EXPLAIN QUERY PLAN（全扫描 vs 过滤条件），给出是否必须 HNSW/sqlite-vec 的证据
// 注意：2026-09-29 实测后内循环已改为 Int8Array 零拷贝视图（原 I8 查表版未优化）；
//       附录 A 的 6.6s/7.2s 数字出自查表版，量级结论（>>3s）对优化后仍成立，复跑可得新数
// 用法：node scripts/bench-poc-r5.mjs [--rows=1000000] [--dim=512] [--queries=15] [--keep]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'

const arg = (name, dft) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : dft
}
const ROWS = arg('rows', 1_000_000)
const DIM = arg('dim', 512)
const QUERIES = arg('queries', 15)
const BLOCK = arg('block', 10_000)
const KEEP = process.argv.includes('--keep')
const DB_DIR = path.join(os.tmpdir(), 'luuk-poc-r5')
const DB_PATH = path.join(DB_DIR, 'embeddings.db')

// int8 有符号化：扫描内循环用 Int8Array 零拷贝视图（见阶段 3），不再需要查表
const randVec = () => crypto.randomBytes(DIM)

const results = { rows: ROWS, dim: DIM, quant: 'int8', block: BLOCK, queries: QUERIES }

function fmtMB(bytes) { return Math.round(bytes / 1048576) }

function main() {
  fs.rmSync(DB_DIR, { recursive: true, force: true })
  fs.mkdirSync(DB_DIR, { recursive: true })

  // ══ 阶段 1：建库 + 批量写入（对齐应用默认：new Database + 无 WAL）══
  let db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE image_embeddings (
      image_id    INTEGER PRIMARY KEY,
      model_id    TEXT NOT NULL,
      dim         INTEGER NOT NULL,
      quant       TEXT NOT NULL,
      vector      BLOB NOT NULL,
      created_at  TEXT NOT NULL,
      dirty       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_emb_model ON image_embeddings(model_id);
  `)
  const ins = db.prepare(
    'INSERT INTO image_embeddings (image_id, model_id, dim, quant, vector, created_at, dirty) VALUES (?,?,?,?,?,?,0)'
  )
  const now = new Date().toISOString()
  const t0 = Date.now()
  const insertBatch = db.transaction((start, end) => {
    for (let id = start; id < end; id++) ins.run(id, 'poc.clip', DIM, 'int8', randVec(), now)
  })
  for (let s = 0; s < ROWS; s += BLOCK) insertBatch(s, Math.min(s + BLOCK, ROWS))
  results.insertMs = Date.now() - t0
  results.insertRowsPerSec = Math.round(ROWS / (results.insertMs / 1000))
  db.close()

  // ══ 阶段 2：体积（数据 + 索引，含溢出页影响如实计入）══
  const sizeOf = (p) => fs.existsSync(p) ? fs.statSync(p).size : 0
  results.dbBytes = sizeOf(DB_PATH)
  results.dbMB = fmtMB(results.dbBytes)
  results.bytesPerRow = Math.round(results.dbBytes / ROWS)
  results.docEstimateMB = 512 // §9.3 预估：100 万张 int8=512MB（纯向量），实际含元字段应略大

  // ══ 阶段 3：语义查询延迟（分块流式暴力扫描 + int8 点积，top-10）══
  db = new Database(DB_PATH, { readonly: true })
  const scan = db.prepare('SELECT image_id, vector FROM image_embeddings')
  const lat = []
  let rssPeak = process.memoryUsage().rss
  const topK = new Array(10).fill(null).map(() => ({ id: -1, s: -(2 ** 31) }))
  for (let q = 0; q < QUERIES; q++) {
    const query = randVec()
    const q8 = new Int8Array(query.buffer, query.byteOffset, DIM) // 零拷贝有符号视图，免内层查表
    const qs = Date.now()
    topK.forEach(t => { t.id = -1; t.s = -(2 ** 31) })
    let count = 0
    for (const row of scan.iterate()) {
      const v = row.vector
      const v8 = new Int8Array(v.buffer, v.byteOffset, DIM)
      let acc = 0
      for (let d = 0; d < DIM; d++) acc += v8[d] * q8[d]
      if (acc > topK[9].s) {
        topK[9].s = acc; topK[9].id = row.image_id
        for (let i = 9; i > 0 && topK[i].s > topK[i - 1].s; i--) [topK[i], topK[i - 1]] = [topK[i - 1], topK[i]]
      }
      if (++count % BLOCK === 0) { const r = process.memoryUsage().rss; if (r > rssPeak) rssPeak = r }
    }
    lat.push(Date.now() - qs)
  }
  lat.sort((a, b) => a - b)
  // 口径注明：15 样本下 P95 索引落在最大值，实为"最差一次查询"而非统计意义上的 P95
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.ceil(p / 100 * arr.length) - 1)]
  results.queryLatenciesMs = lat
  results.queryP50Ms = pct(lat, 50)
  results.queryP95Ms = pct(lat, 95)
  results.queryP95Note = '15 样本，实为最大值'
  results.queryFirstMs = lat[0] // 首查询（相对最冷）
  results.rssPeakMB = fmtMB(rssPeak)
  results.rowsScannedPerQuery = ROWS

  // ══ 阶段 4：EXPLAIN QUERY PLAN 表现 ══
  const eqpOf = (sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail)
  results.eqp = {
    fullScan: eqpOf('SELECT image_id, vector FROM image_embeddings'),
    filterModel: eqpOf("SELECT image_id FROM image_embeddings WHERE model_id = 'poc.clip'"),
    filterDirty: eqpOf('SELECT image_id FROM image_embeddings WHERE dirty = 0 LIMIT 100'),
  }

  // ══ 阶段 5：删除场景（向量随图片删除的 vacuum 影响，抽查）══
  db.close()
  if (!KEEP) { fs.rmSync(DB_DIR, { recursive: true, force: true }) }

  results.verdict = {
    volume: results.dbMB <= results.docEstimateMB * 1.5
      ? `体积 ${results.dbMB}MB，与 §9.3 int8 预估 512MB 同量级（含元字段与页开销 ${results.bytesPerRow}B/行）`
      : `体积 ${results.dbMB}MB，显著超 §9.3 预估，需复核`,
    latency: results.queryP95Ms <= 3000
      ? `P95 ${results.queryP95Ms}ms ≤ §9.4 目标 1-3s，一期暴力扫描成立`
      : `P95 ${results.queryP95Ms}ms > §9.4 目标 3s，触发改道：vectors.db/HNSW 提前引入`,
    eqp: results.eqp.fullScan.some(d => /SCAN/i.test(d))
      ? '向量检索必然 SCAN 全表（SQLite 无向量索引），符合 §9.4「二期视实测再上 HNSW/sqlite-vec」前提'
      : 'EQP 未出现 SCAN，与预期不符需复核',
    memory: `扫描期 RSS 峰值 ${results.rssPeakMB}MB（块大小决定，非库规模）`,
  }
  console.log('===JSON===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`DB kept at: ${KEEP ? DB_PATH : '(removed)'}`)
}

main()
