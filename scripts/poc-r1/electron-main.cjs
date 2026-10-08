// R1 PoC：Electron 40 主进程，fork utilityProcess 运行 worker.cjs 验证推理隔离
const { app, utilityProcess } = require('electron')
const path = require('path')

app.whenReady().then(() => {
  // modelPath 由启动命令尾随传入（electron 会将其置于 process.argv 末尾）
  const modelPath = process.argv[process.argv.length - 1]
  const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { stdio: 'pipe', env: { ...process.env, LUUK_POC_MODEL: modelPath } })
  child.stdout.on('data', (d) => process.stdout.write(d))
  child.stderr.on('data', (d) => process.stderr.write(d))
  child.on('exit', (code) => { app.exit(code ?? 1) })
})
