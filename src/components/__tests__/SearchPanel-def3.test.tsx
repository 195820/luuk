// @vitest-environment jsdom
/**
 * SearchPanel 组件测试（试点，§5.2）。
 * 守护目标：DEF-3 纵深防御契约——mock IPC 返回 undefined，面板不崩、渲染空态。
 * 工具：Vitest + @testing-library/react + jsdom（M-A 基建已就绪）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, installElectronApiMock, flushAsync } from './test-utils'
import { useSearchStore } from '@/stores/searchStore'
import { SearchPanel } from '../SearchPanel'

function resetSearchStore() {
  useSearchStore.setState({
    active: true,
    searching: false,
    criteria: {},
    results: [],
    total: 0,
    hasSearched: false,
    history: [],
    presets: [],
  })
}

describe('SearchPanel DEF-3 契约', () => {
  beforeEach(() => {
    resetSearchStore()
    vi.restoreAllMocks()
  })

  it('IPC 返回 undefined 时面板不崩溃，渲染空态', async () => {
    // 模拟 electronAPI：所有方法默认 resolve undefined（Proxy 模式）
    installElectronApiMock()
    resetSearchStore()

    const { container } = render(<SearchPanel libraryId={1} />)
    await flushAsync() // 等 loadHistoryAndPresets 完成

    // 面板不应崩溃：应渲染基本结构
    expect(container).toBeTruthy()
    // store 的 loadHistoryAndPresets 有 Array.isArray 守卫，仍为空数组
    expect(useSearchStore.getState().history).toEqual([])
    expect(useSearchStore.getState().presets).toEqual([])
  })

  it('IPC 返回正常数组时搜索历史/预设正确加载', async () => {
    const mockHistory = ['cat', 'dog']
    const mockPresets = [{ id: 'p1', name: '风景', criteria: { formats: ['jpg'] }, createdAt: '' }]

    installElectronApiMock({
      getSearchHistory: vi.fn().mockResolvedValue(mockHistory),
      getSearchPresets: vi.fn().mockResolvedValue(mockPresets),
    })
    resetSearchStore()

    render(<SearchPanel libraryId={1} />)
    await waitFor(() => {
      expect(useSearchStore.getState().history).toEqual(mockHistory)
      expect(useSearchStore.getState().presets).toEqual(mockPresets)
    })
  })

  it('搜索按钮触发 searchImages IPC', async () => {
    const searchFn = vi.fn().mockResolvedValue({ success: true, images: [], total: 0 })
    installElectronApiMock({
      searchImages: searchFn,
      getSearchHistory: vi.fn().mockResolvedValue([]),
      getSearchPresets: vi.fn().mockResolvedValue([]),
      addSearchHistory: vi.fn().mockResolvedValue(undefined),
    })
    resetSearchStore()
    useSearchStore.setState({ criteria: { fileName: 'test' } })

    render(<SearchPanel libraryId={1} />)
    await flushAsync()

    // 找到面板内的搜索按钮（排除触发按钮的 title="搜索（Ctrl+F）"）
    const allSearchBtns = screen.getAllByRole('button', { name: /搜索/ })
    const searchBtn = allSearchBtns.find(b => !b.hasAttribute('title'))!
    fireEvent.click(searchBtn)
    await flushAsync()

    expect(searchFn).toHaveBeenCalledWith(1, { fileName: 'test' }, { limit: 100, offset: 0 })
  })

  it('清空按钮重置条件和结果', async () => {
    installElectronApiMock({
      getSearchHistory: vi.fn().mockResolvedValue([]),
      getSearchPresets: vi.fn().mockResolvedValue([]),
    })
    resetSearchStore()
    useSearchStore.setState({
      criteria: { fileName: 'abc' },
      results: [{ id: 1 } as any],
      total: 1,
      hasSearched: true,
    })

    render(<SearchPanel libraryId={1} />)
    await flushAsync()

    const clearBtn = screen.getByRole('button', { name: /清空/ })
    fireEvent.click(clearBtn)

    const st = useSearchStore.getState()
    expect(st.results).toEqual([])
    expect(st.total).toBe(0)
    expect(st.hasSearched).toBe(false)
  })
})
