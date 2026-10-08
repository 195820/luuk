// R10 PoC：Electron 40 主进程，fork utilityProcess 运行 worker.mjs（ESM）
// cjs 宿主经动态 import 装载 ESM worker；echo 端口与通道经 env 传入
const { app, utilityProcess } = require('electron')
const path = require('path')

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, 'child-host.cjs'), [], {
    stdio: 'pipe',
    env: { ...process.env, LUUK_POC_CHANNEL: 'utilityProcess' },
  })
  child.stdout.on('data', (d) => process.stdout.write(d))
  child.stderr.on('data', (d) => process.stderr.write(d))
  child.on('exit', (code) => app.exit(code ?? 1))
})
