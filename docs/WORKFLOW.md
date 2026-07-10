# Workflow: run, verify, test

## Run the dev server
```bash
npm install          # first time only
npm run dev          # prints the URL it actually bound
```
**Port note:** a Docker container (an old build) frequently holds **3000**, so Next
falls back to **3001** and prints `- Local: http://localhost:3001`. Always use the URL
it prints. To check / free the port:
```bash
lsof -ti :3000 -sTCP:LISTEN     # what's on 3000 (often com.docker)
docker compose up -d --build    # rebuild the container to run the current code
```

Against a throwaway database (so you never touch real data):
```bash
DB_PATH=/tmp/test.db npm run dev
```

## Verify EVERY change (both must be clean)
```bash
npx tsc --noEmit     # types — the only true "build" check you need for most edits
npm run lint         # eslint incl. react-hooks rules
```
- After deleting/adding a route, a **stale `.next` types cache** can make `tsc` complain
  about a missing `app/<removed>/page.js`. Fix: `rm -rf .next` and restart dev to
  regenerate, then re-run `tsc`.
- `npm run build` is a heavier full check; use it before shipping big changes.

## Visual / UI testing (headless Chrome)
There's no browser MCP here; drive real Chrome with `puppeteer-core` (Chrome is
installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).

```bash
cd /tmp && npm i puppeteer-core   # once
```
Minimal screenshot + console-error capture:
```js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true }); // check mobile too
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:3001/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000)); // let client charts/fetches settle
  await p.screenshot({ path: '/tmp/shot.png', fullPage: true });
  console.log('ERRORS:', errs.join(' | ') || 'none');
  await b.close();
})();
```
Tips:
- View the PNG to judge layout; also assert programmatically (e.g. an element's
  `scrollWidth <= clientWidth` to catch clipped currency values).
- Detect overflow: compare `document.documentElement.scrollWidth` to `window.innerWidth`.
- To exercise a mutation, fill inputs (`page.type`), submit, assert the result, then
  **delete the test row** via its `[aria-label="Delete …"]` button (auto-accept the
  `confirm()` with `page.on('dialog', d => d.accept())`).
- If `APP_PASSWORD` is set the app redirects to `/login`; either unset it in dev or log
  in first.

## Definition of done
- `tsc --noEmit` and `npm run lint` both clean.
- Headless screenshot shows the change on desktop **and** ~390px mobile, with **no
  console errors**.
- Any test data you inserted is removed; no dev server / temp files left running.
