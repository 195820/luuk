// @vitest-environment node
/**
 * path-safe 工具边界测试（§5.1 单元补盲）。
 * 验证 isPathWithin 对盘符大小写、UNC、反斜杠清理、.. 穿越、同前缀逃逸等场景的正确性。
 */
import { describe, it, expect } from 'vitest'
import { isPathWithin } from '../path-safe'

describe('isPathWithin 边界用例', () => {
  // 基础正常路径
  it('子文件在库内', () => {
    expect(isPathWithin('D:\\library', 'D:\\library\\photos\\a.jpg')).toBe(true)
  })

  it('目录本身等于 root', () => {
    expect(isPathWithin('D:\\library', 'D:\\library')).toBe(true)
  })

  it('库外路径被拒绝', () => {
    expect(isPathWithin('D:\\library', 'D:\\other\\a.jpg')).toBe(false)
  })

  // 盘符大小写（Windows 兼容）
  it('盘符大小写不敏感', () => {
    expect(isPathWithin('d:\\library', 'D:\\library\\a.jpg')).toBe(true)
    expect(isPathWithin('D:\\LIBRARY', 'd:\\library\\sub\\b.png')).toBe(true)
  })

  // .. 穿越攻击
  it('.. 穿越被拒绝', () => {
    expect(isPathWithin('D:\\library', 'D:\\library\\..\\secret\\a.jpg')).toBe(false)
    expect(isPathWithin('D:\\library', 'D:\\library\\sub\\..\\..\\outside.jpg')).toBe(false)
  })

  // 同前缀目录逃逸
  it('同前缀不同目录被拒绝（/lib vs /lib-evil）', () => {
    expect(isPathWithin('D:\\lib', 'D:\\lib-evil\\a.jpg')).toBe(false)
    expect(isPathWithin('/home/user/img', '/home/user/img-backup/a.jpg')).toBe(false)
  })

  // 绝对路径穿越
  it('绝对路径指向外部被拒绝', () => {
    expect(isPathWithin('D:\\library', 'C:\\Windows\\system32\\evil.dll')).toBe(false)
  })

  // 深层嵌套
  it('深层子目录仍在库内', () => {
    expect(isPathWithin('D:\\lib', 'D:\\lib\\a\\b\\c\\d\\e\\photo.jpg')).toBe(true)
  })

  // 尾部斜杠/反斜杠
  it('root 尾部带斜杠仍可正确判断', () => {
    expect(isPathWithin('D:\\library\\', 'D:\\library\\a.jpg')).toBe(true)
    expect(isPathWithin('D:\\library/', 'D:\\library\\a.jpg')).toBe(true)
  })

  // UNC 路径
  it('UNC 路径正确比较', () => {
    expect(isPathWithin('\\\\server\\share\\lib', '\\\\server\\share\\lib\\a.jpg')).toBe(true)
    expect(isPathWithin('\\\\server\\share\\lib', '\\\\server\\share\\other\\a.jpg')).toBe(false)
  })

  // 相对路径解析（path.resolve 会加 cwd 前缀）
  it('相对路径相对于 cwd 解析', () => {
    // 两个相对路径解析到不同位置时，应正确判断
    expect(isPathWithin('./a', './a/b/c.jpg')).toBe(true)
    expect(isPathWithin('./a', './b/c.jpg')).toBe(false)
  })
})
