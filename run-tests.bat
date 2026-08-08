@echo off
set PATH=D:\miniconda3\envs\imageviewer;%PATH%
cd /d D:\luuk
npx playwright test tests/playwright/refactor-electron.spec.ts --project=electron --reporter=list --config=tests/playwright.config.ts
