import { describe, it, expect } from 'vitest'
import { resolveSdkTimeoutMs } from '../worker-sdk'

describe('P1-7 · SDK 反向调用分级/动态超时', () => {
  it('轻量方法默认 5s', () => {
    expect(resolveSdkTimeoutMs('sdk.progress.report', { pct: 10 })).toBe(5000)
    expect(resolveSdkTimeoutMs('sdk.log.info', { msg: 'x' })).toBe(5000)
    expect(resolveSdkTimeoutMs('sdk.settings.get', { key: 'a' })).toBe(5000)
  })

  it('fs.read 60s；resolveModel 30s', () => {
    expect(resolveSdkTimeoutMs('sdk.fs.read', { path: '/a' })).toBe(60000)
    expect(resolveSdkTimeoutMs('sdk.inference.resolveModel', { modelId: 'm' })).toBe(30000)
  })

  it('fs.write/edit.write：60s 基线，按 payload 字节动态追加，每 10MB +5s', () => {
    expect(resolveSdkTimeoutMs('sdk.fs.write', { path: '/a', data: new Uint8Array(0) })).toBe(60000)
    // 25MB → ceil(25/10)=3 → +15s
    const bytes = 25 * 1024 * 1024
    expect(resolveSdkTimeoutMs('sdk.fs.write', { data: new Uint8Array(bytes) })).toBe(75000)
    // edit.write 读 outputBuffer
    expect(resolveSdkTimeoutMs('sdk.edit.write', { outputBuffer: new Uint8Array(bytes) })).toBe(75000)
  })

  it('fs.write 动态超时上限 300s（超大 payload 不无限增长）', () => {
    const huge = { data: { byteLength: 1000 * 1024 * 1024 } } // 1GB（用 byteLength 避免真实分配）
    expect(resolveSdkTimeoutMs('sdk.fs.write', huge)).toBe(300000)
  })
})
