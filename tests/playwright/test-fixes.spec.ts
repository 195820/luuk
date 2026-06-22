import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('修复验证测试', () => {
  let electronApp: any;
  let page: any;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(process.cwd(), 'dist-electron/main.js'), '--no-sandbox'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      },
      timeout: 60000,
    });

    // 跳过 DevTools 窗口
    for (let i = 0; i < 30; i++) {
      const win = electronApp.windows().find((w: any) => !w.url().includes('devtools://'));
      if (win) { page = win; break; }
      await new Promise(r => setTimeout(r, 500));
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('切换到 test 库后音频按钮自动显示', async () => {
    // 确保在网格模式
    const gridBtn = page.locator('button:has-text("▦ 网格")');
    if (await gridBtn.isVisible()) {
      await gridBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // 选择 test 库 (ID=7)
    const select = page.locator('.library-selector select');
    await select.selectOption('7');
    await new Promise(r => setTimeout(r, 3000));

    // 检查音频按钮是否显示
    const audioBtn = page.locator('button:has-text("🎵 音频")');
    const isVisible = await audioBtn.isVisible().catch(() => false);
    console.log('音频按钮可见:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('点击音频按钮显示音频区域', async () => {
    // 点击音频按钮
    const audioBtn = page.locator('button:has-text("🎵 音频")');
    await audioBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // 检查音频区域是否显示
    const audioArea = page.locator('.audio-area');
    const isVisible = await audioArea.isVisible().catch(() => false);
    console.log('音频区域可见:', isVisible);
    expect(isVisible).toBe(true);

    // 检查音频文件数量
    const audioTitle = page.locator('.audio-area-title');
    const titleText = await audioTitle.textContent().catch(() => '');
    console.log('音频标题:', titleText);
    expect(titleText).toContain('1'); // test.mp3
  });

  test('视频加载功能正常', async () => {
    // 查找视频文件
    const gridItems = page.locator('.image-grid-item');
    const count = await gridItems.count();
    console.log('网格项目数:', count);
    let videoFound = false;

    for (let i = 0; i < count; i++) {
      const item = gridItems.nth(i);
      const altText = await item.locator('img').getAttribute('alt').catch(() => '');
      console.log(`项目 ${i}: alt=${altText}`);

      // 查找 mp4 文件
      if (altText?.includes('.mp4')) {
        console.log('找到视频文件:', altText);
        await item.dblclick();
        await new Promise(r => setTimeout(r, 5000));

        // 检查视频元素
        const video = page.locator('video');
        const isVideoVisible = await video.isVisible().catch(() => false);
        console.log('视频元素可见:', isVideoVisible);

        if (isVideoVisible) {
          const videoSrc = await video.getAttribute('src');
          console.log('视频 src:', videoSrc);

          // 检查是否显示错误
          const errorDiv = page.locator('.image-error');
          const hasError = await errorDiv.isVisible().catch(() => false);
          console.log('视频加载错误:', hasError);

          // 检查视频是否可以播放
          const readyState = await video.evaluate((el: HTMLVideoElement) => el.readyState).catch(() => -1);
          console.log('视频 readyState:', readyState);

          expect(hasError).toBe(false);
          videoFound = true;
        }
        break;
      }
    }

    expect(videoFound).toBe(true);
  });

  test('图片缩放功能正常', async () => {
    // 返回网格视图
    const gridBtn = page.locator('button:has-text("▦ 网格")');
    if (await gridBtn.isVisible()) {
      await gridBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // 进入查看器模式
    const viewBtn = page.locator('button:has-text("▶ 查看")');
    if (await viewBtn.isVisible()) {
      await viewBtn.click();
      await new Promise(r => setTimeout(r, 2000));
    }

    // 检查图片是否加载
    const img = page.locator('.yarl__slide img');
    const isImgVisible = await img.isVisible().catch(() => false);
    console.log('图片可见:', isImgVisible);

    if (isImgVisible) {
      const imgStyle = await img.evaluate((el: HTMLImageElement) => {
        const style = window.getComputedStyle(el);
        return {
          maxWidth: style.maxWidth,
          maxHeight: style.maxHeight,
          width: el.clientWidth,
          height: el.clientHeight,
        };
      });
      console.log('图片样式:', imgStyle);

      // 图片应该有合理的尺寸约束
      expect(imgStyle.maxWidth).not.toBe('none');
      expect(imgStyle.maxHeight).not.toBe('none');
      expect(imgStyle.width).toBeLessThan(2000);
      expect(imgStyle.height).toBeLessThan(2000);
    }
  });
});
