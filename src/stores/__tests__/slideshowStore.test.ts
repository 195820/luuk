import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useSlideshowStore,
  registerAudioDisposer,
  disposeAudioResources,
} from '../slideshowStore'

function resetStore() {
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

describe('slideshowStore 播放控制', () => {
  beforeEach(() => {
    disposeAudioResources() // 清空模块级释放器，隔离用例
    resetStore()
  })

  it('setIntervalSec 钳制到 [3, 30]', () => {
    useSlideshowStore.getState().setIntervalSec(1)
    expect(useSlideshowStore.getState().intervalSec).toBe(3)
    useSlideshowStore.getState().setIntervalSec(100)
    expect(useSlideshowStore.getState().intervalSec).toBe(30)
    useSlideshowStore.getState().setIntervalSec(10)
    expect(useSlideshowStore.getState().intervalSec).toBe(10)
  })

  it('start/pause：pause 保留 audioTrack（可恢复）', () => {
    const s = useSlideshowStore.getState()
    s.addAudioTrack('/music/a.mp3')
    s.start()
    expect(useSlideshowStore.getState().isPlaying).toBe(true)
    useSlideshowStore.getState().pause()
    expect(useSlideshowStore.getState().isPlaying).toBe(false)
    expect(useSlideshowStore.getState().audioTrack).not.toBeNull()
  })

  it('stop：清空 isPlaying / audioTrack / playlist', () => {
    const s = useSlideshowStore.getState()
    s.addAudioTrack('/music/a.mp3')
    s.setPlaylist([{ libraryId: 1, imagePath: 'a.jpg' }])
    s.start()
    useSlideshowStore.getState().stop()
    const st = useSlideshowStore.getState()
    expect(st.isPlaying).toBe(false)
    expect(st.audioTrack).toBeNull()
    expect(st.playlist).toEqual([])
  })

  it('addAudioTrack 默认音量 80；setAudioVolume 钳制 [0,100]', () => {
    useSlideshowStore.getState().addAudioTrack('/m.mp3')
    expect(useSlideshowStore.getState().audioTrack).toEqual({ path: '/m.mp3', volume: 80 })
    useSlideshowStore.getState().setAudioVolume(150)
    expect(useSlideshowStore.getState().audioTrack?.volume).toBe(100)
    useSlideshowStore.getState().setAudioVolume(-5)
    expect(useSlideshowStore.getState().audioTrack?.volume).toBe(0)
  })

  it('removeAudioTrack 置空', () => {
    useSlideshowStore.getState().addAudioTrack('/m.mp3')
    useSlideshowStore.getState().removeAudioTrack()
    expect(useSlideshowStore.getState().audioTrack).toBeNull()
  })
})

describe('slideshowStore 音频资源释放器', () => {
  beforeEach(() => {
    disposeAudioResources()
    resetStore()
  })

  it('stop() 显式调用已注册的释放器（不依赖 React effect）', () => {
    const disposer = vi.fn()
    registerAudioDisposer(disposer)
    useSlideshowStore.getState().stop()
    expect(disposer).toHaveBeenCalledTimes(1)
    // 释放后集合被清空：再次 stop 不重复调用
    useSlideshowStore.getState().stop()
    expect(disposer).toHaveBeenCalledTimes(1)
  })

  it('注销函数移除释放器', () => {
    const disposer = vi.fn()
    const unregister = registerAudioDisposer(disposer)
    unregister()
    disposeAudioResources()
    expect(disposer).not.toHaveBeenCalled()
  })

  it('释放器抛错不影响其他释放器与 stop 流程', () => {
    const bad = vi.fn(() => { throw new Error('boom') })
    const good = vi.fn()
    registerAudioDisposer(bad)
    registerAudioDisposer(good)
    expect(() => useSlideshowStore.getState().stop()).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
  })
})

describe('slideshowStore 播放列表管理', () => {
  beforeEach(() => {
    disposeAudioResources()
    resetStore()
  })

  it('savePlaylist 保存运行时列表并设为激活', () => {
    useSlideshowStore.getState().setPlaylist([
      { libraryId: 1, imagePath: 'a.jpg' },
      { libraryId: 1, imagePath: 'b.jpg' },
    ])
    const id = useSlideshowStore.getState().savePlaylist('我的列表')
    const st = useSlideshowStore.getState()
    expect(st.savedPlaylists).toHaveLength(1)
    expect(st.savedPlaylists[0].name).toBe('我的列表')
    expect(st.activePlaylistId).toBe(id)
  })

  it('loadPlaylist 加载指定列表；不存在时不改动', () => {
    useSlideshowStore.getState().setPlaylist([{ libraryId: 1, imagePath: 'a.jpg' }])
    const id = useSlideshowStore.getState().savePlaylist('L1')
    useSlideshowStore.getState().setPlaylist([])
    useSlideshowStore.getState().loadPlaylist(id)
    expect(useSlideshowStore.getState().playlist).toEqual([{ libraryId: 1, imagePath: 'a.jpg' }])
    // 不存在的 id：playlist 不变
    useSlideshowStore.getState().loadPlaylist('missing')
    expect(useSlideshowStore.getState().playlist).toEqual([{ libraryId: 1, imagePath: 'a.jpg' }])
  })

  it('renamePlaylist 更新名称', () => {
    useSlideshowStore.getState().setPlaylist([{ libraryId: 1, imagePath: 'a.jpg' }])
    const id = useSlideshowStore.getState().savePlaylist('旧名')
    useSlideshowStore.getState().renamePlaylist(id, '新名')
    expect(useSlideshowStore.getState().savedPlaylists[0].name).toBe('新名')
  })

  it('reorderPlaylistItems 同步保存列表与激活的运行时列表', () => {
    useSlideshowStore.getState().setPlaylist([
      { libraryId: 1, imagePath: 'a.jpg' },
      { libraryId: 1, imagePath: 'b.jpg' },
      { libraryId: 1, imagePath: 'c.jpg' },
    ])
    const id = useSlideshowStore.getState().savePlaylist('L')
    useSlideshowStore.getState().reorderPlaylistItems(id, 0, 2)
    const st = useSlideshowStore.getState()
    expect(st.savedPlaylists[0].items.map(i => i.imagePath)).toEqual(['b.jpg', 'c.jpg', 'a.jpg'])
    expect(st.playlist.map(i => i.imagePath)).toEqual(['b.jpg', 'c.jpg', 'a.jpg'])
  })

  it('deletePlaylist 删除并清空激活态', () => {
    useSlideshowStore.getState().setPlaylist([{ libraryId: 1, imagePath: 'a.jpg' }])
    const id = useSlideshowStore.getState().savePlaylist('L')
    useSlideshowStore.getState().deletePlaylist(id)
    expect(useSlideshowStore.getState().savedPlaylists).toHaveLength(0)
    expect(useSlideshowStore.getState().activePlaylistId).toBeNull()
  })
})
