// @vitest-environment jsdom
/**
 * SlideshowBar 组件测试（试点，§5.2）。
 * 守护目标：DEF-9 播放驱动——isPlaying 翻转、tick 链路、退出回调。
 * 策略：SlideshowBar 所有关键状态由 props 驱动，子组件（SlideshowAudio/PlaylistEditor）vi.mock。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, installElectronApiMock } from './test-utils'
import { useSlideshowStore } from '@/stores/slideshowStore'

// Mock 子组件（避免引入额外依赖：audio 元素 / 网络请求）
vi.mock('../SlideshowAudio', () => ({ SlideshowAudio: () => null }))
vi.mock('../PlaylistEditor', () => ({ PlaylistEditor: () => null }))

import { SlideshowBar } from '../layout/SlideshowBar'

function resetSlideshowStore() {
  useSlideshowStore.setState({
    mode: 'sequential',
    transition: 'fade',
    intervalSec: 5,
    isPlaying: false,
    playlist: [],
    audioTrack: null,
    savedPlaylists: [],
    activePlaylistId: null,
  })
}

describe('SlideshowBar 播放驱动（DEF-9）', () => {
  beforeEach(() => {
    installElectronApiMock()
    resetSlideshowStore()
    vi.restoreAllMocks()
  })

  it('isPlaying=true 时显示"幻灯片播放中"文本与暂停按钮', () => {
    const noop = () => {}
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={true}
        onToggle={noop}
        onPrevious={noop}
        onNext={noop}
        onExit={noop}
      />
    )
    expect(screen.getByText('幻灯片播放中')).toBeTruthy()
    expect(screen.getByText('暂停')).toBeTruthy()
  })

  it('isPlaying=false 时显示"幻灯片已暂停"文本与播放按钮', () => {
    const noop = () => {}
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={false}
        onToggle={noop}
        onPrevious={noop}
        onNext={noop}
        onExit={noop}
      />
    )
    expect(screen.getByText('幻灯片已暂停')).toBeTruthy()
    expect(screen.getByText('播放')).toBeTruthy()
  })

  it('点击暂停/继续按钮调用 onToggle', () => {
    const onToggle = vi.fn()
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={true}
        onToggle={onToggle}
        onPrevious={() => {}}
        onNext={() => {}}
        onExit={() => {}}
      />
    )
    fireEvent.click(screen.getByText('暂停'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('点击上一张/下一张分别调用 onPrevious/onNext', () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={true}
        onToggle={() => {}}
        onPrevious={onPrevious}
        onNext={onNext}
        onExit={() => {}}
      />
    )
    // 通过 title 属性定位按钮
    fireEvent.click(screen.getByTitle('上一张 (←)'))
    expect(onPrevious).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTitle('下一张 (→)'))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('点击退出按钮调用 onExit', () => {
    const onExit = vi.fn()
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={true}
        onToggle={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onExit={onExit}
      />
    )
    fireEvent.click(screen.getByTitle('退出幻灯片 (Esc)'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('间隔选择器修改 slideshowStore.intervalSec', () => {
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={false}
        onToggle={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onExit={() => {}}
      />
    )
    // select 显示文本为 "5秒"
    const selects = screen.getAllByRole('combobox')
    const intervalSelect = selects[0] // 第一个 select 是间隔
    fireEvent.change(intervalSelect, { target: { value: '10' } })
    expect(useSlideshowStore.getState().intervalSec).toBe(10)
  })

  it('随机播放按钮切换 mode', () => {
    render(
      <SlideshowBar
        libraryId={1}
        isPlaying={false}
        onToggle={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onExit={() => {}}
      />
    )
    expect(useSlideshowStore.getState().mode).toBe('sequential')
    fireEvent.click(screen.getByTitle(/播放模式/))
    expect(useSlideshowStore.getState().mode).toBe('random')
  })
})
