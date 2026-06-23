const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outDir = path.join(root, 'codex-docs/cs-docs/browser-visible');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 180 });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const logs = [];
  const requests = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) logs.push({ type: msg.type(), text: msg.text(), url: page.url() });
  });
  page.on('pageerror', err => logs.push({ type: 'pageerror', text: err.message, url: page.url() }));
  page.on('requestfailed', req => requests.push({ url: req.url(), failure: req.failure() && req.failure().errorText }));

  await page.goto('http://127.0.0.1:8649/#/', { waitUntil: 'networkidle' });
  let body = await page.locator('body').innerText().catch(() => '');
  if (body.includes('输入用户名') || body.includes('登录')) {
    await page.locator('input').nth(0).fill('admin');
    await page.locator('input').nth(1).fill('123456');
    await page.getByRole('button', { name: /登录/ }).click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
  }

  const snapshots = [];
  async function snap(name) {
    await page.waitForTimeout(600);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText().catch(e => `ERR ${e.message}`)).replace(/\s+/g, ' ').slice(0, 1000);
    snapshots.push({ name, url: page.url(), file, text });
  }

  await snap('01-after-login-before-modal-close');
  const remind = page.getByRole('button', { name: /稍后提醒/ });
  if (await remind.count()) {
    await remind.click();
    await page.waitForTimeout(500);
  }
  await snap('02-after-modal-close');

  const navs = [
    ['chat', /对话$/],
    ['history', /历史/],
    ['group-chat', /群聊/],
    ['jobs', /任务/],
    ['kanban', /看板/],
    ['channels', /频道/],
    ['skills', /^技能$/],
    ['plugins', /插件/],
    ['mcp', /^MCP$/],
    ['memory', /记忆/],
    ['models', /模型/],
    ['logs', /日志/],
    ['usage', /用量$/],
    ['performance', /性能监控/],
    ['skills-usage', /技能用量/],
    ['coding-agents', /编程工具/],
    ['version-preview', /版本预览/],
    ['devices', /设备/],
    ['settings', /设置/],
  ];

  for (const [name, label] of navs) {
    const locator = page.getByText(label).first();
    const count = await locator.count().catch(() => 0);
    if (!count) {
      snapshots.push({ name: `nav-${name}`, url: page.url(), file: null, text: `NAV_NOT_FOUND ${label}` });
      continue;
    }
    await locator.click().catch(async e => snapshots.push({ name: `nav-${name}`, url: page.url(), file: null, text: `CLICK_ERR ${e.message}` }));
    await page.waitForLoadState('networkidle').catch(() => {});
    await snap(`nav-${name}`);
  }

  await page.goto('http://127.0.0.1:8649/#/hermes/enterprise-skills', { waitUntil: 'networkidle' }).catch(() => {});
  await snap('direct-enterprise-skills');

  await page.goto('http://127.0.0.1:8649/#/hermes/chat', { waitUntil: 'networkidle' }).catch(() => {});
  const input = page.locator('textarea, [contenteditable="true"], input[placeholder*="消息"]').last();
  if (await input.count()) {
    await input.fill('测试输入，不发送');
  }
  await snap('chat-input-typed-not-sent');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8649/#/hermes/chat', { waitUntil: 'networkidle' }).catch(() => {});
  await snap('mobile-chat');

  fs.writeFileSync(path.join(outDir, 'visible-browser-audit.json'), JSON.stringify({ snapshots, logs, requests }, null, 2), 'utf8');
  await browser.close();
})();
