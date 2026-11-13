// Captures QA evidence from the running local build:
//   - screenshots of every state (default), plus high-contrast, reduced-motion,
//     captions-off and large-caption variants of key states
//   - a full walkthrough video at normal speed
// Usage: npm run build && npx vite preview --port 4173 &  then
//        node scripts/capture-evidence.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const out = process.argv[2] || 'evidence';
mkdirSync(`${out}/screenshots`, { recursive: true });
mkdirSync(`${out}/video`, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const settle = (p) => p.waitForFunction(() => window.__tr.inspect().settled, null, { timeout: 30000 }).then(() => p.waitForTimeout(300));
const phaseIs = (p, ph) => p.waitForFunction((x) => window.__tr.session().phase === x, ph, { timeout: 30000 });
const d = (p, id) => p.getByTestId(`desk-${id}`).click();

async function journey(p, { shoot, settings = {}, fast = true, pauseShot = false }) {
  await p.goto(`${BASE}/${fast ? '?fast' : ''}`);
  await p.getByTestId('enter').waitFor();
  await p.waitForTimeout(fast ? 800 : 2500);
  await shoot('01_welcome');
  await p.getByTestId('enter').click();
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'captionSize') await p.getByTestId(`capsize-${v}`).check();
    else if (v) await p.getByTestId(`set-${k}`).check();
    else await p.getByTestId(`set-${k}`).uncheck();
  }
  await p.getByTestId('ack').check();
  await p.waitForTimeout(fast ? 300 : 1500);
  await shoot('02_prepare');
  await p.getByTestId('continue').click();
  await p.getByTestId('ready').click();
  await d(p, 'CONNECT');
  await p.waitForTimeout(fast ? 300 : 1500);
  await shoot('03_waiting');
  await d(p, 'START');
  await p.waitForFunction(() => window.__tr.session().lineIndex === 2, null, { timeout: 30000 });
  await p.waitForTimeout(fast ? 100 : 1200);
  await shoot('04_conversation');
  await p.waitForFunction(() => window.__tr.session().m01Reached, null, { timeout: 30000 });
  await d(p, 'HOLD');
  await settle(p);
  await p.waitForTimeout(fast ? 0 : 1500);
  await shoot('05_held');
  await d(p, 'UNFOLD');
  await settle(p);
  await p.waitForTimeout(fast ? 0 : 2000);
  await shoot('06_unfolded');
  await p.getByTestId('path-A').click();
  await p.waitForTimeout(fast ? 200 : 1500);
  await shoot('06b_path_a_selected');
  await d(p, 'BEGIN_BRANCH');
  await phaseIs(p, 'EXPLORING');
  await p.waitForTimeout(fast ? 100 : 1500);
  if (fast) await p.evaluate(() => window.__tr.store.send('participant', 'PAUSE'));
  await shoot('07a_explore_A_participant_line');
  if (pauseShot) await shoot('09_pause_overlay');
  if (fast) await p.evaluate(() => window.__tr.store.send('participant', 'RESUME'));
  await p.waitForFunction(() => window.__tr.session().branchStep === 2, null, { timeout: 30000 });
  await p.getByTestId('request-return').click();
  await p.waitForTimeout(fast ? 200 : 2500);
  await shoot('07b_explore_A_alex_reply');
  await d(p, 'RECOMPOSE');
  await settle(p);
  await p.waitForTimeout(fast ? 300 : 2000);
  await shoot('08_recomposed_after_A');
  await d(p, 'UNFOLD');
  await settle(p);
  await p.getByTestId('path-B').click();
  await d(p, 'BEGIN_BRANCH');
  await p.waitForFunction(() => window.__tr.session().branchStep === 2, null, { timeout: 30000 });
  await p.waitForTimeout(fast ? 200 : 2500);
  await shoot('07c_explore_B_alex_reply');
  await d(p, 'RECOMPOSE');
  await settle(p);
  await p.getByText('PASS · pose, lights, camera match').waitFor({ timeout: 30000 });
  await p.waitForTimeout(fast ? 300 : 2000);
  await shoot('08b_recomposed_after_B');
  await d(p, 'DROP');
  await p.waitForTimeout(fast ? 400 : 2000);
  await shoot('10_link_lost');
  await d(p, 'CONNECT');
  await d(p, 'RESUME_SESSION');
  await d(p, 'REFLECT');
  await p.getByTestId('screen-reflection').waitFor();
  await p.waitForTimeout(fast ? 300 : 4000);
  await shoot('11_reflection');
}

async function run(name, opts) {
  const size = opts.video ? { width: 1280, height: 720 } : { width: 1600, height: 900 };
  const ctx = await browser.newContext({ viewport: size });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const wanted = opts.only;
  const shoot = async (n) => {
    if (wanted && !wanted.includes(n)) return;
    await p.screenshot({ path: `${out}/screenshots/${name}__${n}.png` });
  };
  // Video: Chrome DevTools screencast frames, encoded afterwards with system ffmpeg.
  const frames = [];
  let cdp = null;
  if (opts.video) {
    cdp = await ctx.newCDPSession(p);
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push({ data: f.data, t: f.metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: size.width, maxHeight: size.height });
  }
  await journey(p, { ...opts, shoot });
  if (cdp) {
    await p.waitForTimeout(1500);
    await cdp.send('Page.stopScreencast');
    const dir = `${out}/video/frames`;
    mkdirSync(dir, { recursive: true });
    const lines = [];
    frames.forEach((f, i) => {
      const file = `f${String(i).padStart(5, '0')}.jpg`;
      writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'));
      const dur = i + 1 < frames.length ? Math.max(0.01, frames[i + 1].t - f.t) : 1;
      lines.push(`file '${file}'`, `duration ${dur.toFixed(3)}`);
    });
    lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
    writeFileSync(`${dir}/list.txt`, lines.join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
      '-vf', 'fps=30,format=yuv420p,scale=1280:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', `${out}/video/${name}.mp4`]);
    rmSync(dir, { recursive: true, force: true });
    console.log(`video: ${frames.length} frames, ${(frames.at(-1).t - frames[0].t).toFixed(1)} s`);
  }
  await ctx.close();
  console.log(name, errors.length ? errors : 'no page errors');
}

const KEY = ['04_conversation', '05_held', '06_unfolded', '07b_explore_A_alex_reply', '08_recomposed_after_A', '11_reflection', '02_prepare'];
if (!process.env.ONLY_VIDEO) {
await run('default', { pauseShot: true });
await run('high-contrast', { settings: { highContrast: true }, only: KEY });
await run('reduced-motion', { settings: { reducedMotion: true }, only: KEY });
await run('captions-off', { settings: { captions: false }, only: ['04_conversation', '07b_explore_A_alex_reply'] });
await run('captions-large', { settings: { captionSize: 'L' }, only: ['04_conversation', '07b_explore_A_alex_reply'] });
}
if (!process.env.NO_VIDEO) await run('walkthrough', { fast: false, video: true, only: [] });
await browser.close();
