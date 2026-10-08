// R1 PoC worker：在 utilityProcess 子进程内装载 onnxruntime-node 并推理
// Prereq：npm i onnxruntime-node@^1.30.0 --no-save
// 由 electron-main.cjs fork，模型路径经 LUUK_POC_MODEL 环境变量传入；结果以 POC_JSON= 前缀打印到 stdout
const modelPath = process.env.LUUK_POC_MODEL || process.argv[2]

async function main() {
  const ort = require('onnxruntime-node')
  const t0 = Date.now()
  const session = await ort.InferenceSession.create(modelPath)
  const createMs = Date.now() - t0
  const t1 = Date.now()
  const tensor = new ort.Tensor('float32', new Float32Array([-1, 2, -3, 4]), [1, 4])
  const res = await session.run({ X: tensor }, ['Y'])
  const runMs = Date.now() - t1
  const output = Array.from(res.Y.data)
  const ok = output.join() === '0,2,0,4'
  await new Promise((r) => process.stdout.write('POC_JSON=' + JSON.stringify({
    ok, createMs, runMs, output,
    execPath: process.execPath.replace(/\\/g, '/').split('/').pop(),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  }) + '\n', r)) // 等管道 drain，防截断
}

main().then(() => process.exit(0)).catch(e => {
  console.log('POC_JSON=' + JSON.stringify({ error: String(e).slice(0, 300) }))
  process.exit(1)
})
