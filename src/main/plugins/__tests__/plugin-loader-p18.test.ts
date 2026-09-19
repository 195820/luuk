import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import { PluginLoader } from '../plugin-loader'

let counter = 0
async function tmpDir(): Promise<string> {
  counter++
  const d = path.join(process.cwd(), `.test-temp-p18-${Date.now()}-${counter}`)
  await fs.mkdir(d, { recursive: true })
  return d
}

async function writePlugin(dir: string, manifest: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2))
  if (typeof manifest.entry === 'string') {
    await fs.writeFile(path.join(dir, manifest.entry), '// entry')
  }
}

const baseManifest = {
  id: 'p.models',
  name: 'P',
  version: '1.0.0',
  apiVersion: '1.0.0',
  kind: 'ai-transform',
  entry: 'index.js',
  capabilities: [],
}

describe('P1-8 · validateManifest 校验 requires.models[].sha256 格式', () => {
  let builtinDir: string

  beforeEach(async () => {
    builtinDir = await tmpDir()
  })
  afterEach(async () => {
    await fs.rm(builtinDir, { recursive: true, force: true })
  })

  it('合法 64 位十六进制 sha256 → valid', async () => {
    await writePlugin(path.join(builtinDir, 'ok'), {
      ...baseManifest,
      requires: { models: [{ id: 'm1', size: 1, sha256: 'a'.repeat(64) }] },
    })
    const [p] = await new PluginLoader(builtinDir).discover()
    expect(p.state).toBe('valid')
  })

  it('非法 sha256（非 hex / 长度不对）→ invalid', async () => {
    await writePlugin(path.join(builtinDir, 'bad'), {
      ...baseManifest,
      requires: { models: [{ id: 'm1', size: 1, sha256: 'not-a-valid-hash' }] },
    })
    const [p] = await new PluginLoader(builtinDir).discover()
    expect(p.state).toBe('invalid')
    expect(p.error).toMatch(/sha256 非法/)
  })

  it('sha256 缺失/空 → 允许（valid），交由 verifyModel 降级为存在性校验', async () => {
    await writePlugin(path.join(builtinDir, 'empty'), {
      ...baseManifest,
      requires: { models: [{ id: 'm1', size: 1, sha256: '' }] },
    })
    const [p] = await new PluginLoader(builtinDir).discover()
    expect(p.state).toBe('valid')
  })
})
