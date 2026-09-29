/**
 * T8 — Worker 侧插件 Op 注册表（decision-provider 实执行最小集）
 *
 * 运行环境为插件 Worker 进程（electron/plugin-worker.ts），本模块只负责
 * "把插件入口的 op handler 装起来并按 id 调用"，不涉及 RPC 传输。
 *
 * 两种装载来源：
 * 1. **静态内置**（registerBuiltinPlugin）：内置插件随宿主一起被 Vite 打包，
 *    运行时无独立 .js 产物可 import，故由 Worker 侧显式登记 activator；
 * 2. **动态入口**（entryPath）：第三方插件落盘为 JS 文件，按清单 entry 动态 import。
 *
 * 约定：插件入口导出 `activate(): Record<opId, handler>`。
 * ONNX/推理类插件的真实沙箱仍属 Phase 10，此处不为 decision-provider 之外的形态扩散能力。
 */
import { pathToFileURL } from 'url'

/** 单个 op 处理器 */
export type OpHandler = (input: unknown) => unknown | Promise<unknown>

/** op 注册表：opId → handler */
export type OpRegistry = Record<string, OpHandler>

/** 插件激活函数：返回该插件贡献的全部 op */
export type PluginActivator = () => OpRegistry | Promise<OpRegistry>

interface LoadedPlugin {
  entryPath: string
  ops: OpRegistry
}

const loaded = new Map<string, LoadedPlugin>()
const builtinActivators = new Map<string, PluginActivator>()

/**
 * 运行期动态 import
 * `@vite-ignore` 告知构建工具不要改写该调用：插件入口是安装后落盘的绝对路径，构建期不可知
 */
async function runtimeImport(specifier: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
}

/** 登记内置插件 activator（Worker 启动时静态调用） */
export function registerBuiltinPlugin(pluginId: string, activator: PluginActivator): void {
  builtinActivators.set(pluginId, activator)
}

/** 已装载的插件 id 快照（测试/诊断用） */
export function loadedPluginIds(): string[] {
  return [...loaded.keys()]
}

/** 插件已装载的 opId 列表；未装载返回空数组 */
export function loadedOpIds(pluginId: string): string[] {
  return Object.keys(loaded.get(pluginId)?.ops ?? {})
}

/**
 * 装载插件：内置优先走静态 activator，否则动态 import 清单 entry
 * 重复装载幂等（同 entryPath 直接返回既有注册表）
 */
export async function loadPluginEntry(pluginId: string, entryPath: string): Promise<OpRegistry> {
  const existing = loaded.get(pluginId)
  if (existing && existing.entryPath === entryPath) return existing.ops

  const activator = builtinActivators.get(pluginId)
  let ops: OpRegistry

  if (activator) {
    ops = await activator()
  } else {
    const mod = await runtimeImport(pathToFileURL(entryPath).href)
    if (typeof mod.activate !== 'function') {
      throw new Error(`插件入口未导出 activate(): ${pluginId}`)
    }
    ops = (await (mod.activate as PluginActivator)()) as OpRegistry
  }

  if (!ops || typeof ops !== 'object') {
    throw new Error(`插件 activate() 未返回 op 注册表: ${pluginId}`)
  }
  loaded.set(pluginId, { entryPath, ops })
  return ops
}

/** 卸载插件（释放 op 注册表；内置 activator 保留，可再次装载） */
export function unloadPluginEntry(pluginId: string): boolean {
  return loaded.delete(pluginId)
}

/**
 * 调用插件 op
 * 未装载 → 抛错（上层 DecisionRegistry 捕获后回落链尾，D6）
 */
export async function executePluginOp(pluginId: string, opId: string, input: unknown): Promise<unknown> {
  const plugin = loaded.get(pluginId)
  if (!plugin) {
    throw new Error(`插件未装载，无法执行 ${opId}: ${pluginId}`)
  }
  const handler = plugin.ops[opId]
  if (typeof handler !== 'function') {
    throw new Error(`插件 ${pluginId} 不贡献 op: ${opId}（可用: ${Object.keys(plugin.ops).join(', ') || '无'}）`)
  }
  return handler(input)
}

/** 清空注册表与内置登记（测试隔离 / Worker 关闭） */
export function resetPluginRegistry(): void {
  loaded.clear()
  builtinActivators.clear()
}
