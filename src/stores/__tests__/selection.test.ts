import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '../selectionStore';

describe('多选逻辑', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearSelection();
  });

  it('toggleSelection 切换选中并记录锚点', () => {
    const s = useSelectionStore.getState();
    s.toggleSelection('a.jpg');
    expect(useSelectionStore.getState().selectedPaths.has('a.jpg')).toBe(true);
    expect(useSelectionStore.getState().lastSelectedPath).toBe('a.jpg');
    useSelectionStore.getState().toggleSelection('a.jpg');
    expect(useSelectionStore.getState().selectedPaths.has('a.jpg')).toBe(false);
  });

  it('selectRange 正向区间', () => {
    const all = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
    useSelectionStore.getState().selectRange('a.jpg', 'c.jpg', all);
    expect(useSelectionStore.getState().getSelectedPaths().sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('selectRange 反向区间', () => {
    const all = ['a.jpg', 'b.jpg', 'c.jpg'];
    useSelectionStore.getState().selectRange('c.jpg', 'a.jpg', all);
    expect(useSelectionStore.getState().selectedPaths.size).toBe(3);
  });

  it('selectRange 端点不存在时不改动选择', () => {
    useSelectionStore.getState().toggleSelection('a.jpg');
    useSelectionStore.getState().selectRange('a.jpg', 'missing.jpg', ['a.jpg', 'b.jpg']);
    expect(useSelectionStore.getState().selectedPaths.size).toBe(1);
  });

  it('selectRange 与已有选择叠加', () => {
    useSelectionStore.getState().toggleSelection('x.jpg');
    useSelectionStore.getState().selectRange('a.jpg', 'b.jpg', ['a.jpg', 'b.jpg', 'c.jpg']);
    expect(useSelectionStore.getState().selectedPaths.size).toBe(3);
  });

  it('clearSelection 清空所有选择与锚点', () => {
    useSelectionStore.getState().toggleSelection('a.jpg');
    useSelectionStore.getState().toggleSelection('b.jpg');
    useSelectionStore.getState().clearSelection();
    expect(useSelectionStore.getState().selectedPaths.size).toBe(0);
    expect(useSelectionStore.getState().lastSelectedPath).toBeNull();
  });
});
