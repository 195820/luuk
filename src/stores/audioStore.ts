import { create } from 'zustand'

export interface AudioItem {
  libraryId: number
  imageId: number
  src: string
  name: string
}

interface AudioState {
  isPlaying: boolean
  currentAudio: AudioItem | null
  currentTime: number
  duration: number
  volume: number

  play: (libraryId: number, imageId: number, src: string, name: string) => void
  pause: () => void
  resume: () => void
  stop: () => void
  seek: (time: number) => void
  setVolume: (v: number) => void
  setTime: (time: number) => void
  setDuration: (d: number) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  isPlaying: false,
  currentAudio: null,
  currentTime: 0,
  duration: 0,
  volume: 1,

  play: (libraryId, imageId, src, name) => set({
    currentAudio: { libraryId, imageId, src, name },
    isPlaying: true,
    currentTime: 0,
    duration: 0,
  }),

  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),
  stop: () => set({
    isPlaying: false,
    currentAudio: null,
    currentTime: 0,
    duration: 0,
  }),

  seek: (time) => set({ currentTime: time }),
  setVolume: (v) => set({ volume: v }),
  setTime: (time) => set({ currentTime: time }),
  setDuration: (d) => set({ duration: d }),
}))
