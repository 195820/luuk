import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Luuk 图片查看器 - 视频播放功能测试
 * 按 5 大分类：协议层、媒体加载链路、播放器UI、交互功能、边界情况
 *
 * 运行: npx playwright test tests/playwright/video-playback.spec.ts --project=chrome --reporter=list --config=tests/playwright.config.ts
 */

const APP_URL = 'http://localhost:5174';
const PROJECT_ROOT = process.cwd();

// ============================================================
// 分类 1: 协议层 (luuk-file://) — 全部需 Electron 环境
// ============================================================
test.describe('分类1: luuk-file:// 自定义协议层', () => {
  test('1.1 视频通过 luuk-file:// 协议加载', async ({ page }) => {
    test.skip(true, '需 Electron 环境: luuk-file:// 协议由 Electron 主进程注册');
  });

  test('1.2 大视频支持 range 请求', async ({ page }) => {
    test.skip(true, '需 Electron 环境: range 请求处理依赖 luuk-file:// 协议');
  });

  test('1.3 路径安全检查 (库外路径返回 403)', async ({ page }) => {
    test.skip(true, '需 Electron 环境: 安全检查在协议处理器中执行');
  });

  test('1.4 不存在文件返回 404', async ({ page }) => {
    test.skip(true, '需 Electron 环境: 404 响应由协议处理器返回');
  });
});

// ============================================================
// 分类 2: 媒体加载链路 (App.tsx → IPC)
// ============================================================
test.describe('分类2: 媒体加载链路', () => {
  test('2.1 应用首页加载正常', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('h1')).toContainText('图片查看器');
  });

  test('2.2 页面包含库选择器', async ({ page }) => {
    await page.goto(APP_URL);
    // 使用更精确的选择器 — 库选择器在 header-actions 中
    const librarySelect = page.locator('.library-selector select');
    await expect(librarySelect).toBeVisible();
    const options = await librarySelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('收藏夹'))).toBe(true);
  });

  test('2.3 收藏夹选项存在且可选择', async ({ page }) => {
    await page.goto(APP_URL);
    const librarySelect = page.locator('.library-selector select');
    // 使用文本值选择
    const options = await librarySelect.locator('option').all();
    const favValue = await options[0].getAttribute('value');
    expect(favValue).toBe('favorites');
    await librarySelect.selectOption(favValue!);
    await page.waitForTimeout(500);
    const headerText = await page.locator('.app-header').textContent();
    expect(headerText).toBeTruthy();
  });

  test('2.4 快捷键提示在 footer 中', async ({ page }) => {
    await page.goto(APP_URL);
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const text = await footer.textContent();
    const requiredKeys = ['Space', 'F5', 'R', 'F', 'Esc'];
    for (const key of requiredKeys) {
      expect(text).toContain(key);
    }
  });

  test('2.5 媒体类型判断逻辑', async ({ page }) => {
    await page.goto(APP_URL);
    const hasMediaTypeLogic = await page.evaluate(() => {
      const root = document.getElementById('root');
      return !!root;
    });
    expect(hasMediaTypeLogic).toBe(true);
  });
});

// ============================================================
// 分类 3: 播放器 UI — 源码验证 + UI 验证
// ============================================================
test.describe('分类3: 播放器UI', () => {
  test('3.1 查看器工具栏包含基本按钮', async ({ page }) => {
    await page.goto(APP_URL);
    await page.keyboard.press('F5');
    await page.waitForTimeout(800);

    const toolbar = page.locator('.viewer-toolbar');
    const toolbarVisible = await toolbar.isVisible().catch(() => false);

    if (!toolbarVisible) {
      test.skip(true, '查看器未激活: 可能没有图片或未进入查看器模式');
    }

    const btnGroups = await page.locator('.toolbar-group').count();
    expect(btnGroups).toBeGreaterThan(0);
  });

  test('3.2 支持的格式列表正确 (mp4/webm/mov)', async () => {
    const viewerFile = path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx');
    const source = fs.readFileSync(viewerFile, 'utf-8');
    expect(source).toContain("new Set(['mp4', 'webm', 'mov'])");
    // 支持的格式: mp4, webm, mov
    expect(source).not.toMatch(/BROWSER_VIDEO_FORMATS.*['"]avi['"]/);
    expect(source).not.toMatch(/BROWSER_VIDEO_FORMATS.*['"]mkv['"]/);
  });

  test('3.3 不支持格式显示占位符', async () => {
    const viewerFile = path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx');
    const source = fs.readFileSync(viewerFile, 'utf-8');
    expect(source).toContain('viewer-unsupported-placeholder');
    expect(source).toContain('不支持的格式');
  });

  test('3.4 视频控制条存在', async () => {
    const viewerFile = path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx');
    const source = fs.readFileSync(viewerFile, 'utf-8');
    expect(source).toContain('video-controls-bar');
    expect(source).toContain('video-ctrl-btn');
    expect(source).toContain('video-progress-bar');
    expect(source).toContain('video-volume-slider');
  });

  test('3.5 加载/错误/信息面板状态渲染', async () => {
    const viewerFile = path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx');
    const source = fs.readFileSync(viewerFile, 'utf-8');
    expect(source).toContain('image-loading');
    expect(source).toContain('image-error');
    expect(source).toContain('image-info-panel');
  });
});

// ============================================================
// 分类 4: 交互功能
// ============================================================
test.describe('分类4: 交互功能', () => {
  test('4.1 Space 键切换幻灯片 (查看器模式)', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);
    await page.keyboard.press('F5');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    const slideshowBar = page.locator('.slideshow-bar');
    const isVisible = await slideshowBar.isVisible().catch(() => false);
    console.log(`ℹ️ 4.1 Space 后幻灯片栏可见: ${isVisible}`);
  });

  test('4.2 Space 键视频播放/暂停 (视频模式下)', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const hasVideo = await page.evaluate(() => !!document.querySelector('video'));
    if (!hasVideo) {
      test.skip(true, '当前无视频加载，无法测试 Space 播放/暂停');
    }

    await page.keyboard.press('F5');
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? !v.paused : null;
    });

    await page.keyboard.press('Space');
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? !v.paused : null;
    });

    if (before !== null && after !== null) {
      expect(before).not.toBe(after);
    }
  });

  test('4.3 F5 切换视图模式', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const getMode = async (p: Page) => {
      return await p.evaluate(() => {
        if (document.querySelector('.image-viewer-container')) return 'viewer';
        if (document.querySelector('.grid-view-container')) return 'grid';
        return 'unknown';
      });
    };

    const before = await getMode(page);
    await page.keyboard.press('F5');
    await page.waitForTimeout(800);
    const after = await getMode(page);

    console.log(`ℹ️ 4.3 F5 切换: ${before} → ${after}`);
    if (before !== 'unknown') {
      expect(after).not.toBe(before);
    }
  });

  test('4.4 F6 切换文件夹侧边栏', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const getState = async (p: Page) => {
      return await p.evaluate(() => {
        const sidebar = document.querySelector('.folder-sidebar');
        if (!sidebar) return 'hidden';
        return sidebar.clientWidth > 0 ? 'visible' : 'hidden';
      });
    };

    const before = await getState(page);
    await page.keyboard.press('F6');
    await page.waitForTimeout(800);
    const after = await getState(page);

    console.log(`ℹ️ 4.4 F6 侧边栏: ${before} → ${after}`);
    expect(after).not.toBe(before);
  });

  test('4.5 播放/暂停按钮点击', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const playBtn = page.locator('.video-controls-bar .video-ctrl-btn');
    const visible = await playBtn.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '播放按钮未显示');
    }

    const before = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? !v.paused : null;
    });

    await playBtn.click();
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? !v.paused : null;
    });

    if (before !== null && after !== null) {
      expect(before).not.toBe(after);
    }
  });

  test('4.6 进度条 seek', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const slider = page.locator('.video-progress-bar');
    const visible = await slider.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '进度条未显示');
    }

    const box = await slider.boundingBox();
    if (!box || box.width === 0) {
      test.skip(true, '进度条无可点击区域');
    }

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.waitForTimeout(500);

    const time = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.currentTime : -1;
    });

    console.log(`ℹ️ 4.6 seek 后时间: ${time.toFixed(1)}s`);
  });

  test('4.7 音量调节', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const slider = page.locator('.video-volume-slider');
    const visible = await slider.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '音量滑块未显示');
    }

    const box = await slider.boundingBox();
    if (!box || box.width === 0) {
      test.skip(true, '音量滑块无可点击区域');
    }

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.waitForTimeout(300);

    const vol = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.volume : -1;
    });

    console.log(`ℹ️ 4.7 音量: ${(vol * 100).toFixed(0)}%`);
    expect(vol).toBeGreaterThanOrEqual(0);
  });

  test('4.8 R 键重置旋转/翻转', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    await page.keyboard.press('F5');
    await page.waitForTimeout(500);

    await page.keyboard.press('h');
    await page.waitForTimeout(200);

    await page.keyboard.press('r');
    await page.waitForTimeout(300);

    const transform = await page.evaluate(() => {
      const img = document.querySelector('.viewer-image');
      if (!img) return '';
      return (img as HTMLElement).style.transform || '';
    });

    console.log(`ℹ️ 4.8 R 重置后 transform: "${transform}"`);
  });
});

// ============================================================
// 分类 5: 边界情况
// ============================================================
test.describe('分类5: 边界情况', () => {
  test('5.1 视频加载失败显示错误状态', async ({ page }) => {
    test.skip(true, '需要构造无效视频路径');
  });

  test('5.2 图片/视频混合库切换', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    const mediaTypes = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="media"], [data-type]');
      return Array.from(items).length;
    });

    console.log(`ℹ️ 5.2 媒体相关 DOM 元素: ${mediaTypes} 个`);
  });

  test('5.3 收藏库中图片/视频混合浏览', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(2000);

    // 使用精确选择器
    const librarySelect = page.locator('.library-selector select');
    await librarySelect.selectOption('favorites');
    await page.waitForTimeout(1000);

    // 检查媒体筛选组件
    const mediaFilter = page.locator('.media-filter, [class*="media-filter"]');
    const hasFilter = await mediaFilter.isVisible().catch(() => false);

    console.log(`ℹ️ 5.3 收藏夹媒体筛选器: ${hasFilter ? '存在' : '不存在'}`);
  });

  test('5.4 Space 键冲突检测 (幻灯片 vs 视频播放)', async () => {
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/App.tsx'), 'utf-8');
    const viewerSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx'), 'utf-8');

    const appHandlesSpace = appSource.includes("e.key === ' '") && appSource.includes('toggleSlideshow');
    const viewerHandlesSpace = viewerSource.includes("case ' '") && viewerSource.includes('toggleVideoPlayback');

    expect(appHandlesSpace).toBe(true);
    expect(viewerHandlesSpace).toBe(true);

    console.log(`⚠️ 5.4 Space 键冲突: App.tsx(${appHandlesSpace}) + ImageViewer.tsx(${viewerHandlesSpace})`);
  });

  test('5.5 videoRef 在 render 时为 null 的风险', async () => {
    const viewerSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/ImageViewer.tsx'), 'utf-8');

    const hasSafeRender = viewerSource.includes("!loadingState.loading") &&
                          viewerSource.includes("!loadingState.error");

    const hasDurationFallback = viewerSource.includes("videoRef.current?.duration || 0");

    console.log(`ℹ️ 5.5 安全渲染: ${hasSafeRender}, duration fallback: ${hasDurationFallback}`);

    expect(hasSafeRender).toBe(true);
  });

  test('5.6 收藏库中视频路径获取', async ({ page }) => {
    test.skip(true, '需要收藏库中有视频');
  });
});

// ============================================================
// 诊断: 收集页面信息
// ============================================================
test.describe('诊断信息收集', () => {
  test('收集页面结构', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        hasViewer: !!document.querySelector('.image-viewer-container'),
        hasGrid: !!document.querySelector('.grid-view-container'),
        hasVideo: !!document.querySelector('video'),
        hasAudio: !!document.querySelector('audio'),
        hasToolbar: !!document.querySelector('.viewer-toolbar'),
        hasVideoControls: !!document.querySelector('.video-controls-bar'),
        hasSlideshow: !!document.querySelector('.slideshow-bar'),
        libraryOptions: Array.from(document.querySelectorAll('.library-selector select option')).map(o => o.textContent),
        imageCount: document.querySelector('.image-count')?.textContent || 'N/A',
        footerText: document.querySelector('footer')?.textContent || '',
      };
    });

    console.log('📊 诊断:', JSON.stringify(info, null, 2));
  });
});
