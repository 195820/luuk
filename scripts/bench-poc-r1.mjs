// R1 PoC（T-7）：onnxruntime-node 在 Electron 40 + Node 24 的装载与推理验证
// 协议（方向文档 §15-R1）：最小 demo 装载 + 推理；打包验证由 --packaged 分支对 win-unpacked 产物复读
// 注意：--packaged 仅覆盖 build:dir 通道与 ELECTRON_RUN_AS_NODE 探针，nsis 安装产物与干净环境未测（附录 A R1 行已标注）
// Prereq：npm i onnxruntime-node@^1.30.0 --no-save；--packaged 需先 npm run build:dir
// 模型：手写 ONNX protobuf 生成 Relu 最小图（不依赖 Python onnx 包 / 不下载外部权重）
// 用法：node scripts/bench-poc-r1.mjs            → Node 24 装载 + Electron utilityProcess 两段
//       node scripts/bench-poc-r1.mjs --packaged → 对 release/win-unpacked 的 asar.unpacked 路径做同样推理
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require2 = createRequire(import.meta.url)

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const TMP = path.join(os.tmpdir(), 'luuk-poc-r1')

// ── 最小 ONNX protobuf 编码器（proto3 wire format）──
const varint = (x) => { const b = []; x = Math.floor(x); while (x >= 128) { b.push((x % 128) + 128); x = Math.floor(x / 128) } b.push(x); return Buffer.from(b) }
const tag = (field, wire) => varint(field * 8 + wire)
const lenDelim = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf])
const strField = (field, s) => lenDelim(field, Buffer.from(s, 'utf8'))
const intField = (field, v) => Buffer.concat([tag(field, 0), varint(v)])
const sub = (field, buf) => lenDelim(field, buf)

// float32[1,4] --Relu--> float32[1,4]
// onnx.proto 字段：ModelProto{ir_version=1,producer_name=2,graph=7,opset_import=8}
// GraphProto{node=1,name=2,input=11,output=12} NodeProto{input=1,output=2,name=3,op_type=4}
// ValueInfoProto{name=1,type=2} TypeProto{tensor_type=1} Tensor{elem_type=1,shape=2}
// TensorShapeProto{dim=1} Dimension{dim_value=1} OperatorSetIdProto{domain=1,version=2}
function reluModel() {
  const dimension = (v) => lenDelim(1, intField(1, v))                 // shape.dim(field1)=Dimension{dim_value field1}
  const tensorType = (dims) => Buffer.concat([                         // Tensor{elem_type=FLOAT(1), shape}
    intField(1, 1), lenDelim(2, Buffer.concat(dims.map(dimension))),
  ])
  const valueInfo = (name, dims) => Buffer.concat([                   // ValueInfo{name=1, type=2}
    strField(1, name), lenDelim(2, lenDelim(1, tensorType(dims))),    // TypeProto{tensor_type=1}
  ])
  const node = Buffer.concat([strField(1, 'X'), strField(2, 'Y'), strField(3, 'relu0'), strField(4, 'Relu')])
  const graph = Buffer.concat([
    lenDelim(1, node), strField(2, 'poc-r1'),
    lenDelim(11, valueInfo('X', [1, 4])), lenDelim(12, valueInfo('Y', [1, 4])),
  ])
  return Buffer.concat([
    intField(1, 8),            // ir_version (field 1)
    strField(2, 'bench-poc-r1'),  // producer_name (field 2)
    lenDelim(7, graph),        // graph (field 7)
    lenDelim(8, intField(2, 13)), // opset_import (field 8){version=13}
  ])
}

// ── 推理内核（node 与 electron worker 共用逻辑）──
async function runInference(ortRequire, modelPath) {
  const t0 = Date.now()
  const session = await ortRequire.InferenceSession.create(modelPath)
  const createMs = Date.now() - t0
  const t1 = Date.now()
  const tensor = new ortRequire.Tensor('float32', new Float32Array([-1, 2, -3, 4]), [1, 4])
  const results = await session.run({ X: tensor }, ['Y'])
  const runMs = Date.now() - t1
  const out = Array.from(results.Y.data)
  const ok = out.length === 4 && out[0] === 0 && out[1] === 2 && out[2] === 0 && out[3] === 4
  return { ok, createMs, runMs, output: out }
}

const results = { version: null, modelBytes: null }

// 阶段 0：模型生成
fs.mkdirSync(TMP, { recursive: true })
const modelPath = path.join(TMP, 'relu.onnx')
const model = reluModel()
fs.writeFileSync(modelPath, model)
results.modelBytes = model.length

// 读取实际安装版本
results.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/onnxruntime-node/package.json'), 'utf8')).version
results.napiDir = fs.existsSync(path.join(ROOT, 'node_modules/onnxruntime-node/bin/napi-v6/win32/x64'))

const packaged = process.argv.includes('--packaged')
if (packaged) {
  // 打包通道：在 win-unpacked 内用 Electron 自带 node 直接 require asar.unpacked 的 ort
  const unpacked = path.join(ROOT, 'release/win-unpacked/resources/app.asar.unpacked/node_modules/onnxruntime-node')
  results.packagedUnpackedExists = fs.existsSync(unpacked)
  results.packagedDllPresent = fs.existsSync(path.join(unpacked, 'bin/napi-v6/win32/x64/onnxruntime.dll'))
  const electronExe = path.join(ROOT, 'release/win-unpacked/image-viewer.exe')
  const altExe = path.join(ROOT, 'release/win-unpacked/Image Viewer.exe')
  const exe = fs.existsSync(altExe) ? altExe : (fs.existsSync(electronExe) ? electronExe : null)
  results.packagedExe = exe && path.basename(exe)
  if (exe && results.packagedUnpackedExists) {
    const probe = `
      const { pathToFileURL } = require('url')
      const p = ${JSON.stringify(path.join(unpacked, 'dist/index.js'))}
      import(pathToFileURL(p).href).then(async (mod) => {
        const ort = mod.default ?? mod
        const s = await ort.InferenceSession.create(${JSON.stringify(modelPath)})
        const t = new ort.Tensor('float32', new Float32Array([-1,2,-3,4]), [1,4])
        const r = await s.run({ X: t }, ['Y'])
        console.log('POC_JSON=' + JSON.stringify({ ok: Array.from(r.Y.data).join()==='0,2,0,4', output: Array.from(r.Y.data) }))
        process.exit(0)
      }).catch(e => { console.error('POC_FAIL', String(e).slice(0,200)); process.exit(1) })
    `
    const probeFile = path.join(TMP, 'packaged-probe.cjs')
    fs.writeFileSync(probeFile, probe)
    try {
      const out = execFileSync(exe, [probeFile], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000,
      })
      const hit = out.match(/POC_JSON=(.*)/)
      results.packagedInference = hit ? JSON.parse(hit[1]) : { raw: out.slice(0, 300) }
    } catch (e) {
      results.packagedInference = { error: String(e.stdout || e.message).slice(0, 300) }
    }
  }
} else {
  // 通道 1：Node 24 直接装载推理
  const ort = await import('onnxruntime-node')
  try { results.node = await runInference(ort.default ?? ort, modelPath) }
  catch (e) { results.node = { error: String(e).slice(0, 300) } }

  // 通道 2：Electron 40 utilityProcess 装载推理（直用 electron 包导出的二进制路径，避开 npx .cmd）
  try {
    const electronBin = require2(path.join(ROOT, 'node_modules/electron'))
    const out = execFileSync(electronBin, [path.join(ROOT, 'scripts/poc-r1/electron-main.cjs'), modelPath], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
    })
    const hit = out.match(/POC_JSON=(.*)/)
    results.utility = hit ? JSON.parse(hit[1]) : { raw: out.slice(0, 400) }
  } catch (e) {
    results.utility = { error: String(e.stdout || e.message).slice(0, 300) }
  }
}

console.log('===JSON===')
console.log(JSON.stringify(results, null, 2))
