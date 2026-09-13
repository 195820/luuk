import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import { PluginLoader } from '../plugin-loader'

/** 临时目录计数器（避免同一毫秒内冲突） */
let tempDirCounter = 0

/** 创建临时测试目录 */
async function createTempDir(): Promise<string> {
  tempDirCounter++
  const tempDir = path.join(
    process.cwd(),
    `.test-temp-plugins-${Date.now()}-${tempDirCounter}`
  )
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

/** 清理临时目录 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // 忽略清理错误
  }
}

/** 创建合法的插件目录 */
async function createValidPlugin(
  pluginDir: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2)
  )
  // 创建入口文件
  if (manifest.entry && typeof manifest.entry === 'string') {
    await fs.writeFile(path.join(pluginDir, manifest.entry), '// plugin entry')
  }
}

describe('PluginLoader', () => {
  let builtinDir: string
  let thirdPartyDir: string

  beforeEach(async () => {
    builtinDir = await createTempDir()
    thirdPartyDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(builtinDir)
    await cleanupTempDir(thirdPartyDir)
  })

  describe('discover', () => {
    it('发现内置目录下的插件', async () => {
      const loader = new PluginLoader(builtinDir)

      // 创建一个内置插件
      await createValidPlugin(path.join(builtinDir, 'test-plugin'), {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: ['test']
      })

      const plugins = await loader.discover()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].manifest.id).toBe('test-plugin')
      expect(plugins[0].isBuiltin).toBe(true)
    })

    it('发现第三方目录下的插件', async () => {
      const loader = new PluginLoader(builtinDir, thirdPartyDir)

      // 创建一个第三方插件
      await createValidPlugin(path.join(thirdPartyDir, 'third-party-plugin'), {
        id: 'third-party-plugin',
        name: 'Third Party Plugin',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-transform',
        entry: 'index.js',
        capabilities: ['transform']
      })

      const plugins = await loader.discover()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].manifest.id).toBe('third-party-plugin')
      expect(plugins[0].isBuiltin).toBe(false)
    })

    it('同时发现内置和第三方插件', async () => {
      const loader = new PluginLoader(builtinDir, thirdPartyDir)

      await createValidPlugin(path.join(builtinDir, 'builtin'), {
        id: 'builtin',
        name: 'Builtin',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await createValidPlugin(path.join(thirdPartyDir, 'third-party'), {
        id: 'third-party',
        name: 'Third Party',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ui-panel',
        entry: 'index.js',
        capabilities: []
      })

      const plugins = await loader.discover()

      expect(plugins).toHaveLength(2)
      expect(plugins.some(p => p.manifest.id === 'builtin' && p.isBuiltin)).toBe(true)
      expect(plugins.some(p => p.manifest.id === 'third-party' && !p.isBuiltin)).toBe(true)
    })

    it('目录不存在时不报错', async () => {
      const loader = new PluginLoader('/nonexistent/path')
      const plugins = await loader.discover()
      expect(plugins).toHaveLength(0)
    })

    it('重复调用 discover 清空之前的结果', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'plugin1'), {
        id: 'plugin1',
        name: 'Plugin 1',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()
      expect(loader.getPlugins()).toHaveLength(1)

      // 删除插件目录后重新发现
      await fs.rm(path.join(builtinDir, 'plugin1'), { recursive: true })
      await loader.discover()
      expect(loader.getPlugins()).toHaveLength(0)
    })
  })

  describe('validate - 合法插件', () => {
    it('所有字段合法 → state = "valid"', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'valid-plugin'), {
        id: 'valid-plugin',
        name: 'Valid Plugin',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: ['test']
      })

      await loader.discover()
      const plugin = loader.getPlugin('valid-plugin')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('valid')
      expect(plugin?.error).toBeUndefined()
    })

    it('所有 PluginKind 枚举值均合法', async () => {
      const loader = new PluginLoader(builtinDir)
      const kinds = [
        'ai-index',
        'ai-transform',
        'diffusion-provider',
        'crawler-adapter',
        'ui-panel'
      ]

      for (const kind of kinds) {
        await createValidPlugin(path.join(builtinDir, `plugin-${kind}`), {
          id: `plugin-${kind}`,
          name: kind,
          version: '1.0.0',
          apiVersion: '1.0.0',
          kind,
          entry: 'index.js',
          capabilities: []
        })
      }

      await loader.discover()
      const plugins = loader.getPlugins()

      expect(plugins).toHaveLength(5)
      expect(plugins.every(p => p.state === 'valid')).toBe(true)
    })
  })

  describe('validate - 缺少 entry 文件', () => {
    it('entry 文件不存在 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      // 创建清单但不创建入口文件
      const pluginDir = path.join(builtinDir, 'missing-entry')
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify({
          id: 'missing-entry',
          name: 'Missing Entry',
          version: '1.0.0',
          apiVersion: '1.0.0',
          kind: 'ai-index',
          entry: 'index.js', // 不会创建此文件
          capabilities: []
        })
      )

      await loader.discover()
      const plugin = loader.getPlugin('missing-entry')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('入口文件不存在')
    })
  })

  describe('validate - 缺少必需字段', () => {
    it('缺少 id 字段 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'no-id'), {
        // 缺少 id
        name: 'No ID',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()
      const plugin = loader.getPlugin('no-id') // 使用目录名作为 fallback ID

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('缺少必需字段: id')
    })

    it('缺少 name 字段 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      const pluginDir = path.join(builtinDir, 'no-name')
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify({
          id: 'no-name',
          // 缺少 name
          version: '1.0.0',
          apiVersion: '1.0.0',
          kind: 'ai-index',
          entry: 'index.js',
          capabilities: []
        })
      )
      await fs.writeFile(path.join(pluginDir, 'index.js'), '// entry')

      await loader.discover()
      const plugin = loader.getPlugin('no-name')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('缺少必需字段: name')
    })

    it('缺少 capabilities 字段 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      const pluginDir = path.join(builtinDir, 'no-caps')
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify({
          id: 'no-caps',
          name: 'No Caps',
          version: '1.0.0',
          apiVersion: '1.0.0',
          kind: 'ai-index',
          entry: 'index.js'
          // 缺少 capabilities
        })
      )
      await fs.writeFile(path.join(pluginDir, 'index.js'), '// entry')

      await loader.discover()
      const plugin = loader.getPlugin('no-caps')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('缺少必需字段: capabilities')
    })
  })

  describe('validate - 无效的 kind', () => {
    it('kind 不在枚举列表中 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      const pluginDir = path.join(builtinDir, 'invalid-kind')
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify({
          id: 'invalid-kind',
          name: 'Invalid Kind',
          version: '1.0.0',
          apiVersion: '1.0.0',
          kind: 'invalid-kind-type', // 无效的 kind
          entry: 'index.js',
          capabilities: []
        })
      )
      await fs.writeFile(path.join(pluginDir, 'index.js'), '// entry')

      await loader.discover()
      const plugin = loader.getPlugin('invalid-kind')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('无效的插件种类')
    })
  })

  describe('isBuiltin 标识', () => {
    it('内置目录下的插件 isBuiltin = true', async () => {
      const loader = new PluginLoader(builtinDir, thirdPartyDir)

      await createValidPlugin(path.join(builtinDir, 'builtin-plugin'), {
        id: 'builtin-plugin',
        name: 'Builtin',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()
      const plugin = loader.getPlugin('builtin-plugin')

      expect(plugin?.isBuiltin).toBe(true)
    })

    it('第三方目录下的插件 isBuiltin = false', async () => {
      const loader = new PluginLoader(builtinDir, thirdPartyDir)

      await createValidPlugin(path.join(thirdPartyDir, 'third-party-plugin'), {
        id: 'third-party-plugin',
        name: 'Third Party',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()
      const plugin = loader.getPlugin('third-party-plugin')

      expect(plugin?.isBuiltin).toBe(false)
    })
  })

  describe('getPlugin / getPlugins', () => {
    it('getPlugin 返回指定 ID 的插件', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'plugin-a'), {
        id: 'plugin-a',
        name: 'Plugin A',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()

      const plugin = loader.getPlugin('plugin-a')
      expect(plugin).toBeDefined()
      expect(plugin?.manifest.id).toBe('plugin-a')
    })

    it('getPlugin 不存在的插件返回 undefined', async () => {
      const loader = new PluginLoader(builtinDir)
      await loader.discover()

      const plugin = loader.getPlugin('nonexistent')
      expect(plugin).toBeUndefined()
    })

    it('getPlugins 返回所有插件', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'plugin-1'), {
        id: 'plugin-1',
        name: 'Plugin 1',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await createValidPlugin(path.join(builtinDir, 'plugin-2'), {
        id: 'plugin-2',
        name: 'Plugin 2',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-transform',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()
      const plugins = loader.getPlugins()

      expect(plugins).toHaveLength(2)
    })
  })

  describe('setState', () => {
    it('更新插件状态', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'stateful-plugin'), {
        id: 'stateful-plugin',
        name: 'Stateful',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()

      // 初始状态为 valid
      let plugin = loader.getPlugin('stateful-plugin')
      expect(plugin?.state).toBe('valid')

      // 更新为 activated
      loader.setState('stateful-plugin', 'activated')
      plugin = loader.getPlugin('stateful-plugin')
      expect(plugin?.state).toBe('activated')
    })

    it('设置错误信息', async () => {
      const loader = new PluginLoader(builtinDir)

      await createValidPlugin(path.join(builtinDir, 'error-plugin'), {
        id: 'error-plugin',
        name: 'Error',
        version: '1.0.0',
        apiVersion: '1.0.0',
        kind: 'ai-index',
        entry: 'index.js',
        capabilities: []
      })

      await loader.discover()

      loader.setState('error-plugin', 'crashed', '运行时错误')
      const plugin = loader.getPlugin('error-plugin')

      expect(plugin?.state).toBe('crashed')
      expect(plugin?.error).toBe('运行时错误')
    })

    it('更新不存在的插件抛出异常', async () => {
      const loader = new PluginLoader(builtinDir)
      await loader.discover()

      expect(() => {
        loader.setState('nonexistent', 'activated')
      }).toThrow('插件不存在: nonexistent')
    })
  })

  describe('边界情况', () => {
    it('plugin.json 解析失败 → state = "invalid"', async () => {
      const loader = new PluginLoader(builtinDir)

      const pluginDir = path.join(builtinDir, 'invalid-json')
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(path.join(pluginDir, 'plugin.json'), '{ invalid json }')

      await loader.discover()
      const plugin = loader.getPlugin('invalid-json')

      expect(plugin).toBeDefined()
      expect(plugin?.state).toBe('invalid')
      expect(plugin?.error).toContain('读取清单失败')
    })

    it('跳过非目录文件', async () => {
      const loader = new PluginLoader(builtinDir)

      // 在内置目录创建文件（不是目录）
      await fs.writeFile(path.join(builtinDir, 'not-a-directory.txt'), 'content')

      await loader.discover()
      const plugins = loader.getPlugins()

      expect(plugins).toHaveLength(0)
    })
  })
})
