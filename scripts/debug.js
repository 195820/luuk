/**
 * Electron Frontend Debug — 诊断脚本
 *
 * 用法：
 *   1. 启动应用：npm run dev（需开启 CDP，见 SKILL.md Setup）
 *   2. 跑诊断：node scripts/debug.js
 *
 * 输出：
 *   - 终端：JSON 格式报告（console errors / network / DOM / CSS / IPC）
 *   - 文件：debug_full.png（全页截图）
 *
 * 环境变量：
 *   CDP_PORT   — CDP 端口，默认 9222
 *   OUT        — 截图路径，默认 debug_full.png
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_PORT = process.env.CDP_PORT || 9222;
const OUT = process.env.OUT || 'debug_full.png';

// 颜色（终端输出）
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function log(level, msg) {
  const prefix = { error: RED, warn: YELLOW, info: GREEN }[level] || '';
  console.log(`${prefix}[${level.toUpperCase()}]${RESET} ${msg}`);
}

async function main() {
  log('info', `连接 CDP ws://127.0.0.1:${CDP_PORT} ...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  } catch (e) {
    log('error', `无法连接 CDP。请确认：\n  1. npm run dev 已启动\n  2. Electron 启动参数含 --remote-debugging-port=${CDP_PORT}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    log('error', '没有活跃的浏览器上下文（Electron 可能还没创建窗口）');
    await browser.close();
    process.exit(1);
  }

  // 选择应用渲染页（排除 DevTools 页面）
  const allPages = contexts.flatMap(c => c.pages());
  const page = allPages.find(p => !p.url().startsWith('devtools://')) || allPages[0];
  if (!page) {
    log('error', '没有活跃的页面');
    await browser.close();
    process.exit(1);
  }

  log('info', `已连接，页面 URL: ${page.url()}`);

  // ════════════════════════════════════════════
  // LAYER 1: Console errors & page errors
  // ════════════════════════════════════════════
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  // 等 2 秒收集已有错误
  await new Promise(r => setTimeout(r, 2000));

  // ════════════════════════════════════════════
  // LAYER 2: Network failures
  // ════════════════════════════════════════════
  const networkFailures = [];
  page.on('response', resp => {
    const status = resp.status();
    if (status >= 400 || status === 0) {
      networkFailures.push({ status, url: resp.url() });
    }
  });

  // 刷新页面以捕获网络请求（可选，注释掉则只抓增量）
  // await page.reload({ waitUntil: 'networkidle' });

  // ════════════════════════════════════════════
  // LAYER 3: DOM + CSS 快照
  // ════════════════════════════════════════════
  const domReport = await page.evaluate(() => {
    const results = {};

    // 关键容器高度（白屏根因：height=0）
    for (const sel of ['body', '#root', '#app', '[data-testid="image-grid"]']) {
      const el = document.querySelector(sel);
      if (!el) { results[sel] = 'NOT_FOUND'; continue; }
      const cs = getComputedStyle(el);
      results[sel] = {
        height: cs.height,
        display: cs.display,
        overflow: cs.overflow,
        position: cs.position,
        visibility: cs.visibility,
        opacity: cs.opacity,
      };
    }

    // 高度 0 但有子元素的容器（布局崩溃指标）
    results.zeroHeightContainers = [...document.querySelectorAll('*')]
      .filter(el => {
        const h = getComputedStyle(el).height;
        return h === '0px' && el.children.length > 0 &&
          !['SCRIPT', 'STYLE', 'META', 'LINK'].includes(el.tagName);
      })
      .map(el => ({
        tag: el.tagName,
        id: el.id || '',
        class: (el.className?.toString() || '').substring(0, 80),
      }))
      .slice(0, 10);

    // 页面基础信息
    results.title = document.title;
    results.elementCount = document.querySelectorAll('*').length;

    // 检查 Liquid Glass 变量（本项目特有）
    const rootStyle = getComputedStyle(document.documentElement);
    results.cssVars = {
      '--border': rootStyle.getPropertyValue('--border').trim(),
      '--glass-l1': rootStyle.getPropertyValue('--glass-l1').trim(),
      '--accent': rootStyle.getPropertyValue('--accent').trim(),
    };

    return results;
  });

  // ════════════════════════════════════════════
  // LAYER 4: 交互测试（键盘/按钮）
  // ════════════════════════════════════════════
  const interactionReport = {};

  // 4a. 键盘快捷键：← → Esc F
  const keysToTest = [
    { key: 'ArrowLeft',  label: '上一张' },
    { key: 'ArrowRight', label: '下一张' },
    { key: 'Escape',     label: '关闭查看器' },
    { key: 'f',          label: '收藏' },
    { key: 'i',          label: '图片信息' },
  ];

  for (const { key, label } of keysToTest) {
    // 记录按键前的 DOM 状态
    const before = await page.evaluate(() => document.querySelectorAll('*').length);
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, 300));
    const after = await page.evaluate(() => document.querySelectorAll('*').length);
    interactionReport[`key_${key}`] = {
      label,
      domChanged: before !== after,
      elementsBefore: before,
      elementsAfter: after,
    };
  }

  // 4b. 关键按钮是否可点击（不被遮挡）
  const buttonsToCheck = [
    { selector: '[title="搜索（Ctrl+F）"]', label: '搜索按钮' },
    { selector: '[title="外观设置"]', label: '外观设置' },
  ];

  for (const { selector, label } of buttonsToCheck) {
    const check = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const rect = el.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const topEl = document.elementFromPoint(center.x, center.y);
      return {
        found: true,
        label: sel,
        coveredBy: topEl === el ? 'ITSELF' : `${topEl?.tagName}.${(topEl?.className?.toString() || '').substring(0, 40)}`,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        pointerEvents: getComputedStyle(el).pointerEvents,
      };
    }, selector);
    interactionReport[`btn_${label}`] = check;
  }

  // ════════════════════════════════════════════
  // LAYER 5: IPC 探针（本项目特有）
  // ════════════════════════════════════════════
  const ipcReport = {};

  const ipcProbes = [
    { name: 'getLibraries',        call: 'window.electronAPI.getLibraries()' },
    { name: 'getSearchPresets',    call: 'window.electronAPI.getSearchPresets()' },
    { name: 'getSearchHistory',    call: 'window.electronAPI.getSearchHistory()' },
    { name: 'jobsList',            call: 'window.electronAPI.jobsList()' },
    { name: 'pluginsList',         call: 'window.electronAPI.pluginsList()' },
  ];

  for (const { name, call } of ipcProbes) {
    try {
      const result = await page.evaluate(call);
      ipcReport[name] = { success: true, data: result };
    } catch (e) {
      ipcReport[name] = { success: false, error: e.message };
    }
  }

  // 特别检查：searchPresets 是否为 undefined（DEF-3）
  if (ipcReport.getSearchPresets?.success) {
    const presets = ipcReport.getSearchPresets.data;
    if (presets === undefined || presets === null) {
      ipcReport.getSearchPresets.WARNING = '返回值为 undefined/null，会导致 SearchPanel 崩溃（DEF-3）';
    } else if (!Array.isArray(presets?.data)) {
      ipcReport.getSearchPresets.WARNING = `data 字段不是数组: ${typeof presets?.data}`;
    }
  }

  // ════════════════════════════════════════════
  // LAYER 6: 截图
  // ════════════════════════════════════════════
  await page.screenshot({ path: OUT, fullPage: true });
  log('info', `截图已保存: ${OUT}`);

  // ════════════════════════════════════════════
  // 汇总报告
  // ════════════════════════════════════════════
  const report = {
    timestamp: new Date().toISOString(),
    pageUrl: page.url(),
    consoleErrors,
    pageErrors,
    networkFailures: networkFailures.slice(0, 20),
    domReport,
    interactionReport,
    ipcReport,
  };

  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSTIC REPORT');
  console.log('='.repeat(60));
  console.log(JSON.stringify(report, null, 2));

  // 关键告警
  if (pageErrors.length > 0) {
    log('error', `发现 ${pageErrors.length} 个 JS 错误（pageerror）`);
    pageErrors.forEach(e => log('error', `  → ${e.substring(0, 100)}`));
  }
  if (domReport.zeroHeightContainers?.length > 0) {
    log('warn', `发现 ${domReport.zeroHeightContainers.length} 个高度0容器（可能布局崩溃）`);
  }
  if (domReport.cssVars?.['--border']?.includes('white') || domReport.cssVars?.['--border'] === '#fff' || domReport.cssVars?.['--border'] === '#ffffff') {
    log('warn', `--border 为白色，Liquid Glass 去白框失效（M1）`);
  }

  await browser.close();
  log('info', '诊断完成');
}

main().catch(e => {
  log('error', e.message);
  process.exit(1);
});
