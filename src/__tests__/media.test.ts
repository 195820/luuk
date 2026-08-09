import { describe, it, expect } from 'vitest'
import {
  getExtFromPath,
  getMediaTypeFromPath,
  getMimeTypeFromPath,
  isMediaFile,
  isVideoFile,
  isAudioFile,
  isBrowserPlayableVideo,
} from '../utils/media'

describe('getExtFromPath', () => {
  it('小写化扩展名', () => {
    expect(getExtFromPath('photo.JPG')).toBe('.jpg')
  })

  it('无扩展名返回空字符串', () => {
    expect(getExtFromPath('noext')).toBe('')
  })

  it('处理多层扩展名（取最后一个点）', () => {
    expect(getExtFromPath('file.tar.gz')).toBe('.gz')
  })

  it('处理带路径的文件', () => {
    expect(getExtFromPath('/path/to/file.mp4')).toBe('.mp4')
  })
})

describe('getMediaTypeFromPath', () => {
  it('图片文件返回 image', () => {
    expect(getMediaTypeFromPath('photo.jpg')).toBe('image')
    expect(getMediaTypeFromPath('photo.png')).toBe('image')
    expect(getMediaTypeFromPath('photo.webp')).toBe('image')
  })

  it('视频文件返回 video', () => {
    expect(getMediaTypeFromPath('video.mp4')).toBe('video')
    expect(getMediaTypeFromPath('video.mkv')).toBe('video')
    expect(getMediaTypeFromPath('video.mov')).toBe('video')
  })

  it('音频文件返回 audio', () => {
    expect(getMediaTypeFromPath('song.mp3')).toBe('audio')
    expect(getMediaTypeFromPath('song.flac')).toBe('audio')
  })

  it('未知扩展名默认返回 image', () => {
    expect(getMediaTypeFromPath('file.xyz')).toBe('image')
  })
})

describe('getMimeTypeFromPath', () => {
  it('常见图片 MIME', () => {
    expect(getMimeTypeFromPath('a.jpg')).toBe('image/jpeg')
    expect(getMimeTypeFromPath('a.png')).toBe('image/png')
  })

  it('常见视频 MIME', () => {
    expect(getMimeTypeFromPath('a.mp4')).toBe('video/mp4')
  })

  it('未知扩展名返回 octet-stream', () => {
    expect(getMimeTypeFromPath('a.xyz')).toBe('application/octet-stream')
  })
})

describe('isMediaFile', () => {
  it('识别图片', () => expect(isMediaFile('a.jpg')).toBe(true))
  it('识别视频', () => expect(isMediaFile('a.mp4')).toBe(true))
  it('识别音频', () => expect(isMediaFile('a.mp3')).toBe(true))
  it('非媒体文件', () => expect(isMediaFile('a.txt')).toBe(false))
})

describe('isVideoFile / isAudioFile', () => {
  it('isVideoFile 区分视频', () => {
    expect(isVideoFile('a.mp4')).toBe(true)
    expect(isVideoFile('a.jpg')).toBe(false)
  })
  it('isAudioFile 区分音频', () => {
    expect(isAudioFile('a.mp3')).toBe(true)
    expect(isAudioFile('a.jpg')).toBe(false)
  })
})

describe('isBrowserPlayableVideo', () => {
  it('mp4/webm/mov 可播放', () => {
    expect(isBrowserPlayableVideo('a.mp4')).toBe(true)
    expect(isBrowserPlayableVideo('a.webm')).toBe(true)
    expect(isBrowserPlayableVideo('a.mov')).toBe(true)
  })
  it('mkv/avi 不可原生播放', () => {
    expect(isBrowserPlayableVideo('a.mkv')).toBe(false)
    expect(isBrowserPlayableVideo('a.avi')).toBe(false)
  })
})
