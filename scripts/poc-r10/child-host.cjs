// utilityProcess 内的 cjs 跳板：动态 import ESM worker（worker.mjs 打印结果后自行 exit）
const path = require('path')
const { pathToFileURL } = require('url')
import(pathToFileURL(path.join(__dirname, 'worker.mjs')).href).catch((e) => {
  console.log('POC_JSON=' + JSON.stringify({ error: 'ESM import failed: ' + String(e).slice(0, 300) }))
  process.exit(1)
})
