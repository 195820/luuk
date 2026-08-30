import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ImageGridItemComponent } from '../ImageGridItem'
import type { ImageGridItem } from '../ImageGrid'

describe('ImageGridItem 右键菜单', () => {
  const mockImage: ImageGridItem = {
    id: 1,
    src: 'test.jpg',
    alt: 'Test Image',
    width: 100,
    height: 100,
    libraryId: 1,
    imagePath: 'photos/test.jpg',
  }

  it('右键点击应该调用 onContextMenu 回调', () => {
    const onContextMenu = vi.fn()

    const { container } = render(
      <ImageGridItemComponent
        image={mockImage}
        isSelected={false}
        onContextMenu={onContextMenu}
        thumbnailSize={200}
        formatFileSize={() => '100 KB'}
        libraryId={1}
      />
    )

    // 找到 grid-card div
    const gridCard = container.querySelector('.grid-card')
    expect(gridCard).toBeTruthy()

    // 右键点击
    fireEvent.contextMenu(gridCard!, {
      clientX: 100,
      clientY: 200,
    })

    // 验证 onContextMenu 被调用
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledWith(
      mockImage,
      expect.objectContaining({
        clientX: 100,
        clientY: 200,
      })
    )
  })

  it('右键点击应该阻止默认行为', () => {
    const onContextMenu = vi.fn()

    const { container } = render(
      <ImageGridItemComponent
        image={mockImage}
        isSelected={false}
        onContextMenu={onContextMenu}
        thumbnailSize={200}
        formatFileSize={() => '100 KB'}
        libraryId={1}
      />
    )

    const gridCard = container.querySelector('.grid-card')!

    // 创建事件并检查 defaultPrevented
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 200,
    })

    gridCard.dispatchEvent(event)

    // e.preventDefault() 应该被调用
    expect(event.defaultPrevented).toBe(true)
  })
})
