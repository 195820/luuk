/**
 * T8 — Worker 侧插件 Op 注册表单测
 * 覆盖：内置静态 activator 装载、第三方入口动态 import、activate 约定、
 *       未装载/未知 op 抛错、装载幂等、卸载
 */
import path from 'path'
import { existsSync } from 'fs'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  executePluginOp,
  loadPluginEntry,
  loadedOpIds,
  loadedPluginIds,
  registerBuiltinPlugin,
  resetPluginRegistry,
  unloadPluginEntry,
} from '../plugin-registry'
import { activate as activateAutotone } from '../builtins/autotone'
import autotoneManifest from '../builtins/autotone/plugin.json'

/**
 * 夹具入口为项目内的 .mjs 文件
 * （测试运行器的模块解析只放行项目根目录内的绝对路径，故不用临时目录）
 */
function fixture(name: string): string {
  return path.resolve(__dirname, 'fixtures', name)
}

beforeEach(() => {
  resetPluginRegistry()
})

describe('loadPluginEntry / executePluginOp', () => {
  it('内置插件走静态 activator，不读磁盘入口文件', async () => {
    registerBuiltinPlugin('builtin.demo', () => ({
      'demo.echo': input => ({ echoed: input }),
    }))

    const ops = await loadPluginEntry('builtin.demo', '不存在的入口.js')
    expect(ops).toHaveProperty('demo.echo')
    expect(await executePluginOp('builtin.demo', 'demo.echo', 42)).toEqual({ echoed: 42 })
  })

  it('第三方插件按 entry 动态 import 并调用 activate()', async () => {
    await loadPluginEntry('third', fixture('third.mjs'))
    expect(await executePluginOp('third', 'third.add', { a: 2, b: 3 })).toEqual({ sum: 5 })
    expect(loadedPluginIds()).toEqual(['third'])
    expect(loadedOpIds('third')).toEqual(['third.add'])
  })

  it('入口未导出 activate() → 抛错', async () => {
    await expect(loadPluginEntry('bad', fixture('no-activate.mjs'))).rejects.toThrow(/activate/)
  })

  it('activate() 返回非对象 → 抛错', async () => {
    await expect(loadPluginEntry('bad2', fixture('bad-activate.mjs'))).rejects.toThrow(/未返回 op 注册表/)
  })

  it('入口文件不存在 → 抛错（上层据此回落本地规则）', async () => {
    await expect(loadPluginEntry('ghost', fixture('不存在的入口.mjs'))).rejects.toThrow()
  })

  it('未装载就执行 → 抛错（上层据此回落本地规则）', async () => {
    await expect(executePluginOp('missing', 'x.y', {})).rejects.toThrow(/未装载/)
  })

  it('调用插件不贡献的 op → 抛错并提示可用 op', async () => {
    registerBuiltinPlugin('builtin.demo', () => ({ 'demo.a': () => 1 }))
    await loadPluginEntry('builtin.demo', 'unused')
    await expect(executePluginOp('builtin.demo', 'demo.b', {})).rejects.toThrow(/demo\.a/)
  })

  it('同 entryPath 重复装载幂等（不重复执行 activate）', async () => {
    let activations = 0
    registerBuiltinPlugin('builtin.count', () => {
      activations++
      return { 'count.get': () => activations }
    })

    await loadPluginEntry('builtin.count', 'same-path')
    await loadPluginEntry('builtin.count', 'same-path')
    expect(activations).toBe(1)
  })

  it('卸载后不可执行，内置插件可再次装载', async () => {
    registerBuiltinPlugin('builtin.re', () => ({ 're.run': () => 'ok' }))
    await loadPluginEntry('builtin.re', 'p')
    expect(loadedOpIds('builtin.re')).toEqual(['re.run'])

    expect(unloadPluginEntry('builtin.re')).toBe(true)
    await expect(executePluginOp('builtin.re', 're.run', {})).rejects.toThrow(/未装载/)

    await loadPluginEntry('builtin.re', 'p')
    expect(await executePluginOp('builtin.re', 're.run', {})).toBe('ok')
    expect(unloadPluginEntry('builtin.re')).toBe(true)
    expect(unloadPluginEntry('builtin.re')).toBe(false)
  })
})

describe('内置插件装载契约回归（M2 确立，Phase 8 遗留缺陷 builtin.autotone）', () => {
  it('builtin.autotone 走 SDK 契约：activate(sdk) 返回实现 executeOp 的 PluginInstance', () => {
    const instance = activateAutotone({} as never)
    expect(typeof instance.executeOp).toBe('function')
  })

  it('builtin.autotone 清单 entry 指向磁盘真实存在的文件（存在性校验不判 invalid）', () => {
    expect(existsSync(path.resolve(__dirname, '../builtins/autotone', autotoneManifest.entry))).toBe(true)
  })
})
