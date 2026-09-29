/**
 * T10 — 隐私护栏单测（D9 的宿主侧强制约束）
 * 覆盖：字段名黑名单归一匹配、路径/内联图片/嵌入向量识别、递归过滤留痕、
 *       问题定义过滤、state 与 questions 合并过滤入口
 */
import { describe, it, expect } from 'vitest'
import type { DecisionContext } from '../../../../../types/agent'
import {
  PRIVACY_GUARD_PARAMS,
  filterContextForRemote,
  filterDecisionContextForRemote,
  filterStateForRemote,
  isBlockedFieldName,
  looksLikeBinaryBlob,
  looksLikePath,
  normalizeFieldName,
} from '../privacy-guard'

describe('字段名黑名单', () => {
  it('归一化后精确匹配：camel/snake/分隔符变体一律命中', () => {
    expect(normalizeFieldName('filePath')).toBe('filepath')
    for (const name of ['filePath', 'file_path', 'FILE-PATH', 'absolute.path']) {
      expect(isBlockedFieldName(name), name).toBe(true)
    }
  })

  it('业务字段不误伤（keywords 不被 path 类黑名单连带命中）', () => {
    for (const name of ['keywords', 'tags', 'description', 'title', 'sourceName']) {
      expect(isBlockedFieldName(name), name).toBe(false)
    }
  })

  it('凭据/图像/地理类字段全在黑名单内', () => {
    for (const name of ['embedding', 'phash', 'imageBytes', 'dataUrl', 'gpsLat', 'exif', 'apiKey', 'authorization']) {
      expect(isBlockedFieldName(name), name).toBe(true)
    }
  })
})

describe('值形态识别', () => {
  it('疑似路径：Windows 盘符 / UNC / POSIX 绝对路径 / 家目录', () => {
    for (const v of ['C:\\Users\\me\\a.jpg', 'D:/photos/a.jpg', '\\\\nas\\share\\a.jpg', '/mnt/e/lib/a.jpg', '~/docs/a.jpg']) {
      expect(looksLikePath(v), v).toBe(true)
    }
  })

  it('正常文本元数据不算路径', () => {
    for (const v of ['sunset beach', 'golden/hour 风格', '2026-09 旅行', '']) {
      expect(looksLikePath(v), v).toBe(false)
    }
  })

  it('疑似内联图片：data URL 与超长纯 base64 串', () => {
    expect(looksLikeBinaryBlob('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(looksLikeBinaryBlob('A'.repeat(300))).toBe(true)
    expect(looksLikeBinaryBlob('A'.repeat(200))).toBe(false)
    expect(looksLikeBinaryBlob('a sunset photo, quite long description '.repeat(10))).toBe(false)
  })
})

describe('filterStateForRemote', () => {
  it('白名单内的文本元数据原样出站', () => {
    const state = {
      tags: ['sunset', 'beach'],
      title: '金色时刻',
      score: 0.8,
      favorite: true,
      nested: { author: 'alice', description: 'sea' },
    }
    const { state: out, rejected } = filterStateForRemote(state)
    expect(out).toEqual(state)
    expect(rejected).toEqual([])
  })

  it('敏感字段/路径/向量/二进制逐项剔除并留痕', () => {
    const state = {
      tags: ['sunset'],
      filePath: 'E:\\lib\\a.jpg',
      features: Array.from({ length: PRIVACY_GUARD_PARAMS.MAX_NUMBER_ARRAY_LENGTH + 1 }, (_, i) => i / 100),
      gps: { lat: 30.1, lon: 120.2 },
      meta: { filePath: 'E:\\lib\\b.jpg', tags: ['sea'] },
      thumbnail: 'data:image/png;base64,' + 'A'.repeat(300),
      note: 'x'.repeat(PRIVACY_GUARD_PARAMS.MAX_STRING_LENGTH + 1),
      broken: Number.NaN,
      empty: null,
    }
    const { state: out, rejected } = filterStateForRemote(state)

    expect(Object.keys(out)).toEqual(['tags', 'meta'])
    const paths = rejected.map(r => r.path)
    expect(paths).toEqual(expect.arrayContaining(['state.filePath', 'state.features', 'state.thumbnail', 'state.note']))
    expect(paths).toContain('state.gps') // 容器字段名即命中黑名单，整个子树不下发
    expect(rejected.find(r => r.path === 'state.meta.filePath')?.reason).toContain('字段名命中敏感黑名单')
    expect(out.meta).toEqual({ tags: ['sea'] })
    expect(rejected.find(r => r.path === 'state.features')?.reason).toContain('疑似嵌入向量')
    expect(rejected.find(r => r.path === 'state.note')?.reason).toContain('超长字符串')
  })

  it('数组内脏项逐个剔除，保留合法项', () => {
    const { state: out, rejected } = filterStateForRemote({ tags: ['sunset', 'E:\\a.jpg', 'beach'] })
    expect(out.tags).toEqual(['sunset', 'beach'])
    expect(rejected[0].path).toBe('state.tags[1]')
  })

  it('全部字段被剔除 → 空 state（上层据此判不可用）', () => {
    const { state: out } = filterStateForRemote({
      filePath: 'E:\\a.jpg',
      features: Array.from({ length: PRIVACY_GUARD_PARAMS.MAX_NUMBER_ARRAY_LENGTH + 1 }, (_, i) => i / 100),
    })
    expect(out).toEqual({})
  })
})

describe('filterContextForRemote', () => {
  const ctx: DecisionContext = {
    state: {},
    questions: {
      pick: { type: 'choice', instructions: '选最合适的一张', criteria: { sunset: '黄昏', filePath: null, portrait: '人像' } },
      quality: { type: 'score', instructions: '打质量分', criteria: ['low', 'high'] },
      spam: { type: 'noul', instructions: '是否为垃圾内容' },
    },
  }

  it('三类问题形态完整保留', () => {
    const { questions, rejected } = filterContextForRemote(ctx)
    expect(Object.keys(questions)).toEqual(['pick', 'quality', 'spam'])
    expect(questions.pick).toEqual({ type: 'choice', instructions: '选最合适的一张', criteria: { sunset: '黄昏', portrait: '人像' } })
    expect(questions.spam).toEqual({ type: 'noul', instructions: '是否为垃圾内容' })
    expect(rejected.map(r => r.path)).toContain('questions.pick.criteria.filePath')
  })

  it('指令文本命中敏感形态 → 该题整体丢弃', () => {
    const { questions } = filterContextForRemote({
      state: {},
      questions: {
        leak: { type: 'noul', instructions: 'E:\\photos\\a.jpg' },
        keep: { type: 'noul', instructions: '是否适合推荐' },
      },
    })
    expect(Object.keys(questions)).toEqual(['keep'])
  })

  it('选项全部被剔除的 choice 题丢弃；档位被剔除的 score 题保留剩余档位', () => {
    const { questions } = filterContextForRemote({
      state: {},
      questions: {
        all: { type: 'choice', instructions: '选择', criteria: { path: null, embedding: null } },
        parts: { type: 'score', instructions: '打分', criteria: ['low', 'C:\\x\\high'] },
      },
    })
    expect(questions.all).toBeUndefined()
    expect(questions.parts).toEqual({ type: 'score', instructions: '打分', criteria: ['low'] })
  })
})

describe('filterDecisionContextForRemote（合并入口）', () => {
  it('state 与 questions 的剔除记录合并到一份清单', () => {
    const { state, questions, rejected } = filterDecisionContextForRemote({
      state: { tags: ['sunset'], filePath: 'E:\\a.jpg' },
      questions: { pick: { type: 'noul', instructions: '是否推荐' }, spam: { type: 'noul', instructions: 'D:\\b' } },
    })
    expect(state).toEqual({ tags: ['sunset'] })
    expect(Object.keys(questions)).toEqual(['pick'])
    expect(rejected.map(r => r.path).sort()).toEqual(['questions.spam.instructions', 'state.filePath'].sort())
  })
})
