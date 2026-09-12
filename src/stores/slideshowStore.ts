import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { logger } from '../utils/logger'

/** 幻灯片播放模式 */
export type SlideshowMode = 'sequential' | 'random'

/** 过渡动画类型 */
export type SlideshowTransition = 'fade' | 'slide' | 'zoom'

/** 背景音乐轨道 */
export interface AudioTrack {
  /** 音频文件绝对路径 */
  path: string
  /** 音量 0-100 */
  volume: number
}

/** 自定义播放列表项 */
export interface PlaylistItem {
  libraryId: number
  imagePath: string
}

/** 保存的播放列表 */
export interface SavedPlaylist {
  id: string
  name: string
  items: PlaylistItem[]
  createdAt: string
}

interface SlideshowState {
  /** 播放模式 */
  mode: SlideshowMode
  /** 过渡动画类型 */
  transition: SlideshowTransition
  /** 切换间隔（秒） */
  intervalSec: number
  /** 是否正在播放 */
  isPlaying: boolean
  /** 当前播放列表（运行时） */
  playlist: PlaylistItem[]
  /** 背景音乐 */
  audioTrack: AudioTrack | null
  /** 保存的播放列表（持久化） */
  savedPlaylists: SavedPlaylist[]
  /** 当前激活的播放列表 ID（null = 使用默认列表） */
  activePlaylistId: string | null

  /** 切换播放模式 */
  toggleMode: () => void
  /** 设置过渡动画 */
  setTransition: (t: SlideshowTransition) => void
  /** 设置切换间隔 */
  setInterval: (sec: number) => void
  /** 设置播放状态 */
  setPlaying: (playing: boolean) => void
  /** 设置运行时播放列表 */
  setPlaylist: (items: PlaylistItem[]) => void
  /** 添加背景音乐 */
  addAudioTrack: (path: string) => void
  /** 移除背景音乐 */
  removeAudioTrack: () => void
  /** 设置音乐音量 */
  setAudioVolume: (volume: number) => void
  /** 保存当前播放列表 */
  savePlaylist: (name: string) => string
  /** 加载保存的播放列表 */
  loadPlaylist: (id: string) => void
  /** 删除保存的播放列表 */
  deletePlaylist: (id: string) => void
  /** 重命名播放列表 */
  renamePlaylist: (id: string, name: string) => void
  /** 重新排序播放列表项 */
  reorderPlaylistItems: (playlistId: string, fromIndex: number, toIndex: number) => void
  /** 启动幻灯片（进入播放状态） */
  start: () => void
  /** 停止幻灯片（退出播放状态，必须释放资源） */
  stop: () => void
}

/** 默认切换间隔 */
const DEFAULT_INTERVAL_SEC = 5

/** 间隔范围 */
const MIN_INTERVAL = 3
const MAX_INTERVAL = 30

/** 生成唯一 ID */
function generateId(): string {
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useSlideshowStore = create<SlideshowState>()(
  persist(
    (set, get) => ({
      mode: 'sequential',
      transition: 'fade',
      intervalSec: DEFAULT_INTERVAL_SEC,
      isPlaying: false,
      playlist: [],
      audioTrack: null,
      savedPlaylists: [],
      activePlaylistId: null,

      toggleMode: () => set(state => ({
        mode: state.mode === 'sequential' ? 'random' : 'sequential'
      })),

      setTransition: (t) => set({ transition: t }),

      setInterval: (sec) => {
        const clamped = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, sec))
        set({ intervalSec: clamped })
      },

      setPlaying: (playing) => set({ isPlaying: playing }),

      setPlaylist: (items) => set({ playlist: items }),

      addAudioTrack: (path) => set({
        audioTrack: { path, volume: get().audioTrack?.volume ?? 80 }
      }),

      removeAudioTrack: () => set({ audioTrack: null }),

      setAudioVolume: (volume) => set(state => ({
        audioTrack: state.audioTrack
          ? { ...state.audioTrack, volume: Math.max(0, Math.min(100, volume)) }
          : null
      })),

      savePlaylist: (name) => {
        const id = generateId()
        const items = get().playlist
        const newPlaylist: SavedPlaylist = {
          id,
          name,
          items: [...items],
          createdAt: new Date().toISOString()
        }
        set(state => ({
          savedPlaylists: [...state.savedPlaylists, newPlaylist],
          activePlaylistId: id
        }))
        logger.info('Slideshow', `保存播放列表: ${name} (${items.length} 项)`)
        return id
      },

      loadPlaylist: (id) => {
        const playlist = get().savedPlaylists.find(p => p.id === id)
        if (!playlist) {
          logger.warn('Slideshow', `播放列表不存在: ${id}`)
          return
        }
        set({
          playlist: [...playlist.items],
          activePlaylistId: id
        })
      },

      deletePlaylist: (id) => {
        set(state => {
          const filtered = state.savedPlaylists.filter(p => p.id !== id)
          return {
            savedPlaylists: filtered,
            // 若删除的是当前激活的播放列表，清空激活状态
            activePlaylistId: state.activePlaylistId === id ? null : state.activePlaylistId
          }
        })
        logger.info('Slideshow', `删除播放列表: ${id}`)
      },

      renamePlaylist: (id, name) => {
        set(state => ({
          savedPlaylists: state.savedPlaylists.map(p =>
            p.id === id ? { ...p, name } : p
          )
        }))
      },

      reorderPlaylistItems: (playlistId, fromIndex, toIndex) => {
        set(state => {
          const updateItems = (items: PlaylistItem[]): PlaylistItem[] => {
            const result = [...items]
            const [moved] = result.splice(fromIndex, 1)
            result.splice(toIndex, 0, moved)
            return result
          }

          // 更新保存的播放列表
          const savedPlaylists = state.savedPlaylists.map(p =>
            p.id === playlistId ? { ...p, items: updateItems(p.items) } : p
          )

          // 若重排的是当前激活的播放列表，同步更新运行时列表
          const playlist = state.activePlaylistId === playlistId
            ? updateItems(state.playlist)
            : state.playlist

          return { savedPlaylists, playlist }
        })
      },

      start: () => {
        set({ isPlaying: true })
        logger.info('Slideshow', '幻灯片开始播放')
      },

      stop: () => {
        // 停止时清理音乐轨道，释放资源
        set({
          isPlaying: false,
          audioTrack: null
        })
        logger.info('Slideshow', '幻灯片已停止，资源已释放')
      }
    }),
    {
      name: 'slideshow-storage',
      // 仅持久化用户偏好设置，运行时状态不持久化
      partialize: (state) => ({
        savedPlaylists: state.savedPlaylists,
        activePlaylistId: state.activePlaylistId,
        mode: state.mode,
        transition: state.transition,
        intervalSec: state.intervalSec
      }),
    }
  )
)
