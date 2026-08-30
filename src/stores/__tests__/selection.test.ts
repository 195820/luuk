import { describe, it, expect, beforeEach } from 'vitest';
import { useImageStore } from '../imageStore';

describe('多选逻辑', () => {
  beforeEach(() => {
    useImageStore.getState().clearSelection();
  });

  it('toggleSelection 切换选中并记录锚点', () => {
    const s = useImageStore.getState();
    s.toggleSelection('a.jpg');
    expect(useImageStore.getState().selectedPaths.has('a.jpg')).toBe(true);
    expect(useImageStore.getState().lastSelectedPath).toBe('a.jpg');
    useImageStore.getState().toggleSelection('a.jpg');
    expect(useImageStore.getState().selectedPaths.has('a.jpg')).toBe(false);
  });

  it('selectRange 正向区间', () => {
    const all = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
    useImageStore.getState().selectRange('a.jpg', 'c.jpg', all);
    expect(useImageStore.getState().getSelectedPaths().sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('selectRange 反向区间', () => {
    const all = ['a.jpg', 'b.jpg', 'c.jpg'];
    useImageStore.getState().selectRange('c.jpg', 'a.jpg', all);
    expect(useImageStore.getState().selectedPaths.size).toBe(3);
  });

  it('selectRange 端点不存在时不改动选择', () => {
    useImageStore.getState().toggleSelection('a.jpg');
    useImageStore.getState().selectRange('a.jpg', 'missing.jpg', ['a.jpg', 'b.jpg']);
    expect(useImageStore.getState().selectedPaths.size).toBe(1);
  });

  it('selectRange 与已有选择叠加', () => {
    useImageStore.getState().toggleSelection('x.jpg');
    useImageStore.getState().selectRange('a.jpg', 'b.jpg', ['a.jpg', 'b.jpg', 'c.jpg']);
    expect(useImageStore.getState().selectedPaths.size).toBe(3);
  });

  it('clearSelection 清空所有选择与锚点', () => {
    useImageStore.getState().toggleSelection('a.jpg');
    useImageStore.getState().toggleSelection('b.jpg');
    useImageStore.getState().clearSelection();
    expect(useImageStore.getState().selectedPaths.size).toBe(0);
    expect(useImageStore.getState().lastSelectedPath).toBeNull();
  });
});
