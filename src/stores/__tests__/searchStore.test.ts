import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSearchStore } from '../searchStore'

// 模拟 preload 暴露的 electronAPI（searchStore 通过 window.electronAPI 走 IPC）
function installApiMock() {
  const api = {
    searchImages: vi.fn(),
    semanticSearchImages: vi.fn(),
    getSearchHistory: vi.fn().mockResolvedValue([]),
    getSearchPresets: vi.fn().mockResolvedValue([]),
    addSearchHistory: vi.fn().mockResolvedValue(undefined),
    clearSearchHistory: vi.fn().mockResolvedValue(undefined),
    saveSearchPreset: vi.fn().mockResolvedValue(undefined),
    deleteSearchPreset: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as any).electronAPI = api
  return api
}

function resetStore() {
  useSearchStore.setState({
    active: false,
    searching: false,
    criteria: {},
    results: [],
    total: 0,
    hasSearched: false,
    mode: 'keyword',
    semanticError: null,
    history: [],
    presets: [],
  })
}

describe('searchStore 条件与面板', () => {
  beforeEach(() => {
    installApiMock()
    resetStore()
  })

  it('setCriteria 合并局部条件', () => {
    useSearchStore.getState().setCriteria({ fileName: 'cat' })
    useSearchStore.getState().setCriteria({ minWidth: 100 } as any)
    expect(useSearchStore.getState().criteria).toEqual({ fileName: 'cat', minWidth: 100 })
  })

  it('openPanel/closePanel：关闭时重置结果与条件', () => {
    useSearchStore.getState().openPanel()
    useSearchStore.getState().setCriteria({ fileName: 'x' })
    useSearchStore.setState({ results: [{ id: 1 } as any], total: 1, hasSearched: true })
    expect(useSearchStore.getState().active).toBe(true)
    useSearchStore.getState().closePanel()
    const st = useSearchStore.getState()
    expect(st.active).toBe(false)
    expect(st.results).toEqual([])
    expect(st.total).toBe(0)
    expect(st.hasSearched).toBe(false)
    expect(st.criteria).toEqual({})
    expect(st.mode).toBe('keyword')
  })
})

describe('searchStore 历史与预设', () => {
  let api: ReturnType<typeof installApiMock>
  beforeEach(() => {
    api = installApiMock()
    resetStore()
  })

  it('loadHistoryAndPresets 并行拉取并写入', async () => {
    api.getSearchHistory.mockResolvedValue(['a', 'b'])
    api.getSearchPresets.mockResolvedValue([{ id: 'p1', name: 'P', criteria: {}, createdAt: '' }])
    await useSearchStore.getState().loadHistoryAndPresets()
    expect(useSearchStore.getState().history).toEqual(['a', 'b'])
    expect(useSearchStore.getState().presets).toHaveLength(1)
  })

  it('addToHistory 调用 IPC 并刷新历史', async () => {
    api.getSearchHistory.mockResolvedValue(['new', 'old'])
    await useSearchStore.getState().addToHistory('new')
    expect(api.addSearchHistory).toHaveBeenCalledWith('new')
    expect(useSearchStore.getState().history).toEqual(['new', 'old'])
  })

  it('clearHistory 清空本地历史', async () => {
    useSearchStore.setState({ history: ['a'] })
    await useSearchStore.getState().clearHistory()
    expect(api.clearSearchHistory).toHaveBeenCalled()
    expect(useSearchStore.getState().history).toEqual([])
  })

  it('saveAsPreset 用当前条件保存并刷新预设', async () => {
    useSearchStore.getState().setCriteria({ fileName: 'dog' })
    api.getSearchPresets.mockResolvedValue([{ id: 'p1', name: 'My', criteria: { fileName: 'dog' }, createdAt: '' }])
    await useSearchStore.getState().saveAsPreset('My')
    expect(api.saveSearchPreset).toHaveBeenCalledWith('My', { fileName: 'dog' })
    expect(useSearchStore.getState().presets).toHaveLength(1)
  })

  it('removePreset 删除并刷新预设', async () => {
    useSearchStore.setState({ presets: [{ id: 'p1', name: 'A', criteria: {}, createdAt: '' }] })
    api.getSearchPresets.mockResolvedValue([])
    await useSearchStore.getState().removePreset('p1')
    expect(api.deleteSearchPreset).toHaveBeenCalledWith('p1')
    expect(useSearchStore.getState().presets).toEqual([])
  })

  it('loadPreset 写入条件并展开面板', () => {
    useSearchStore.getState().loadPreset({ id: 'p', name: 'P', criteria: { fileName: 'z' }, createdAt: '' })
    expect(useSearchStore.getState().criteria).toEqual({ fileName: 'z' })
    expect(useSearchStore.getState().active).toBe(true)
  })
})

describe('searchStore.search', () => {
  let api: ReturnType<typeof installApiMock>
  beforeEach(() => {
    api = installApiMock()
    resetStore()
  })

  it('成功：写入 results/total，并记录文件名到历史', async () => {
    useSearchStore.getState().setCriteria({ fileName: 'cat' })
    api.searchImages.mockResolvedValue({ success: true, images: [{ id: 1 }, { id: 2 }], total: 2 })
    await useSearchStore.getState().search(1)
    const st = useSearchStore.getState()
    expect(st.hasSearched).toBe(true)
    expect(st.searching).toBe(false)
    expect(st.results).toHaveLength(2)
    expect(st.total).toBe(2)
    expect(api.addSearchHistory).toHaveBeenCalledWith('cat')
  })

  it('失败：清空结果并结束搜索态', async () => {
    api.searchImages.mockResolvedValue({ success: false, error: 'boom' })
    await useSearchStore.getState().search(1)
    const st = useSearchStore.getState()
    expect(st.results).toEqual([])
    expect(st.total).toBe(0)
    expect(st.searching).toBe(false)
  })

  it('异常：捕获后清空结果', async () => {
    api.searchImages.mockRejectedValue(new Error('ipc down'))
    await useSearchStore.getState().search(1)
    expect(useSearchStore.getState().results).toEqual([])
    expect(useSearchStore.getState().searching).toBe(false)
  })

  it('searchSemantic 成功：写入 results/total、切 mode=semantic、记录查询到历史', async () => {
    api.semanticSearchImages.mockResolvedValue({ success: true, images: [{ id: 1, similarity: 88 }, { id: 2, similarity: 70 }] })
    await useSearchStore.getState().searchSemantic(1, '一只猫在草地上')
    const st = useSearchStore.getState()
    expect(st.mode).toBe('semantic')
    expect(st.hasSearched).toBe(true)
    expect(st.searching).toBe(false)
    expect(st.results).toHaveLength(2)
    expect(st.total).toBe(2)
    expect(api.semanticSearchImages).toHaveBeenCalledWith(1, '一只猫在草地上', 200)
    expect(api.addSearchHistory).toHaveBeenCalledWith('一只猫在草地上')
  })

  it('searchSemantic 空查询：提前清空结果且不调用 IPC', async () => {
    useSearchStore.setState({ results: [{ id: 1 } as any], total: 1 })
    await useSearchStore.getState().searchSemantic(1, '   ')
    const st = useSearchStore.getState()
    expect(st.results).toEqual([])
    expect(st.total).toBe(0)
    expect(st.mode).toBe('semantic')
    expect(api.semanticSearchImages).not.toHaveBeenCalled()
  })

  it('searchSemantic 失败：清空结果并结束搜索态（#2：同时上屏 semanticError）', async () => {
    api.semanticSearchImages.mockResolvedValue({ success: false, error: 'boom' })
    await useSearchStore.getState().searchSemantic(1, 'cat')
    const st = useSearchStore.getState()
    expect(st.results).toEqual([])
    expect(st.total).toBe(0)
    expect(st.searching).toBe(false)
    expect(st.semanticError).toBe('boom')
  })

  it('searchSemantic 成功：清除旧 semanticError（#2）', async () => {
    useSearchStore.setState({ semanticError: '陈旧错误' })
    api.semanticSearchImages.mockResolvedValue({ success: true, images: [{ id: 1, similarity: 88 }] })
    await useSearchStore.getState().searchSemantic(1, 'cat')
    expect(useSearchStore.getState().semanticError).toBeNull()
  })

  it('searchSemantic 进入语义模式清空关键词条件（#11）', async () => {
    useSearchStore.getState().setCriteria({ fileName: 'A' })
    api.semanticSearchImages.mockResolvedValue({ success: true, images: [{ id: 1, similarity: 88 }] })
    await useSearchStore.getState().searchSemantic(1, 'B')
    expect(useSearchStore.getState().criteria).toEqual({})
  })

  it('过期响应丢弃（#1 seq guard）：先发的关键词搜索被随后的语义搜索覆盖', async () => {
    api.searchImages.mockResolvedValue({ success: true, images: [{ id: 1 }], total: 1 })
    api.semanticSearchImages.mockResolvedValue({ success: true, images: [{ id: 9, similarity: 90 }] })
    const p1 = useSearchStore.getState().search(1)
    const p2 = useSearchStore.getState().searchSemantic(1, 'cat')
    await Promise.all([p1, p2])
    const st = useSearchStore.getState()
    expect(st.mode).toBe('semantic')
    expect(st.results.map((r) => r.id)).toEqual([9])
  })

  it('searchSemantic 异常：捕获后清空结果', async () => {
    api.semanticSearchImages.mockRejectedValue(new Error('ipc down'))
    await useSearchStore.getState().searchSemantic(1, 'cat')
    expect(useSearchStore.getState().results).toEqual([])
    expect(useSearchStore.getState().searching).toBe(false)
  })

  it('loadMore 语义模式下门控：不触发分页 IPC', async () => {
    api.semanticSearchImages.mockResolvedValue({ success: true, images: Array.from({ length: 200 }, (_, i) => ({ id: i })) })
    await useSearchStore.getState().searchSemantic(1, 'cat')
    api.searchImages.mockClear()
    await useSearchStore.getState().loadMore(1)
    expect(api.searchImages).not.toHaveBeenCalled()
  })
})
