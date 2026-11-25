// End-to-end acceptance tests on the running app (manual section 17, T01–T14).
import { expect, test, type Page } from '@playwright/test';

const ORIGINAL = 'I’d like us to revisit your proposal.';

type Inspect = {
  camera: { position: number[]; quaternion: number[] };
  alex: Record<string, unknown>;
  landmarks: Record<string, number[]>;
  panels: { A: number; B: number };
  settled: boolean;
};

const session = (p: Page) => p.evaluate(() => (window as any).__tr.session());
const inspect = (p: Page) => p.evaluate(() => (window as any).__tr.inspect()) as Promise<Inspect>;
const phase = async (p: Page) => (await session(p)).phase as string;
const desk = (p: Page, id: string) => p.getByTestId(`desk-${id}`);

async function settled(p: Page) {
  await p.waitForFunction(() => (window as any).__tr.inspect().settled, null, { timeout: 20_000 });
}

async function boot(p: Page, query = '?fast&dev') {
  await p.goto(`/${query}`);
  await expect(p.getByTestId('enter')).toBeVisible();
}

async function toWaiting(p: Page) {
  await p.getByTestId('enter').click();
  await p.getByTestId('ack').check();
  await p.getByTestId('continue').click();
  await expect(p.getByTestId('screen-waiting')).toBeVisible();
}

async function toM01(p: Page) {
  await toWaiting(p);
  await p.getByTestId('ready').click();
  await desk(p, 'CONNECT').click();
  await desk(p, 'START').click();
  await p.waitForFunction(() => (window as any).__tr.session().m01Reached);
}

async function toHeld(p: Page) {
  await toM01(p);
  await desk(p, 'HOLD').click();
  await expect.poll(() => phase(p)).toBe('HELD');
  await settled(p);
}

async function explore(p: Page, b: 'A' | 'B') {
  if ((await phase(p)) !== 'UNFOLDED') await desk(p, 'UNFOLD').click();
  await expect(p.getByTestId(`path-${b}`)).toBeVisible();
  await settled(p);
  await p.getByTestId(`path-${b}`).click();
  await desk(p, 'BEGIN_BRANCH').click();
  await expect.poll(() => phase(p)).toBe('EXPLORING');
}

async function rawSend(p: Page, type: string) {
  const h = p.locator('details.diagnostics');
  if (!(await h.evaluate((d: HTMLDetailsElement) => d.open))) await h.locator('summary').click();
  await p.getByTestId('raw-type').selectOption(type);
  await p.getByTestId('raw-send').click();
}

test('T01 entry: no session before acknowledgement and Ready', async ({ page }) => {
  await boot(page);
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('continue')).toBeDisabled();
  await page.getByTestId('ack').check();
  await page.getByTestId('continue').click();
  await desk(page, 'CONNECT').click();
  await expect(desk(page, 'START')).toBeDisabled();
  await rawSend(page, 'START');
  await expect(page.getByTestId('desk-notice')).toContainText('not ready');
  expect(await phase(page)).toBe('WAITING');
});

test('T02 start: rejected while disconnected, accepted when connected + ready', async ({ page }) => {
  await boot(page);
  await toWaiting(page);
  await page.getByTestId('ready').click();
  await expect(desk(page, 'START')).toBeDisabled();
  await rawSend(page, 'START');
  await expect(page.getByTestId('desk-notice')).toContainText('disconnected');
  await desk(page, 'CONNECT').click();
  await expect(page.getByTestId('wait-connected')).toContainText('Therapist connected');
  await desk(page, 'START').click();
  await expect.poll(() => phase(page)).toBe('CONVERSATION');
});

test('T03 canonical line is identical in conversation, hold, unfold, restore and reflection', async ({ page }) => {
  await boot(page);
  await toM01(page);
  await expect(page.getByTestId('caption')).toContainText(ORIGINAL);
  await desk(page, 'HOLD').click();
  await expect(page.getByTestId('original-quote')).toContainText(`“${ORIGINAL}”`);
  await desk(page, 'UNFOLD').click();
  await expect(page.getByTestId('original-quote')).toContainText(/unchanged/i);
  await expect(page.getByTestId('original-quote')).toContainText(`“${ORIGINAL}”`);
  await explore(page, 'A');
  await desk(page, 'RECOMPOSE').click();
  await expect(page.getByTestId('original-quote')).toContainText(`“${ORIGINAL}”`);
  await desk(page, 'REFLECT').click();
  await expect(page.getByTestId('reflect-original')).toHaveText(`“${ORIGINAL}”`);
});

test('T04 hold freezes Alex at M01 and shows no branch options', async ({ page }) => {
  await boot(page);
  await toM01(page);
  await expect(desk(page, 'HOLD')).toBeEnabled();
  await desk(page, 'HOLD').click();
  await expect(page.getByTestId('original-quote')).toContainText(/moment held/i);
  await expect(page.getByTestId('original-quote')).toContainText('Held by your therapist');
  await expect(page.getByTestId('path-A')).toBeHidden();
  await expect(page.getByTestId('path-B')).toBeHidden();
  await settled(page);
  const a = (await inspect(page)).alex;
  await page.waitForTimeout(1500);
  const b = (await inspect(page)).alex;
  expect(b).toEqual(a); // frozen frame: nothing moves
  expect(a.pose).toBe('held');
  const s = await session(page);
  expect(s.snapshot.anchorId).toBe('M01');
  expect(s.snapshot.scene.caption.text).toBe(ORIGINAL);
});

test('T05 unfold keeps the same room and labels both paths hypothetical', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  const before = await inspect(page);
  await desk(page, 'UNFOLD').click();
  await settled(page);
  const after = await inspect(page);
  expect(after.landmarks).toEqual(before.landmarks);
  expect(after.camera).toEqual(before.camera);
  expect(after.panels).toEqual({ A: 1, B: 1 });
  await expect(page.getByTestId('path-A')).toContainText('Path A · Hypothetical');
  await expect(page.getByTestId('path-A')).toContainText('Ask for clarity');
  await expect(page.getByTestId('path-B')).toContainText('Path B · Hypothetical');
  await expect(page.getByTestId('path-B')).toContainText('Share a view');
  await expect(page.getByTestId('original-quote')).toBeVisible();
  // left / right placement
  const ax = (await page.getByTestId('path-A').boundingBox())!.x;
  const bx = (await page.getByTestId('path-B').boundingBox())!.x;
  expect(ax).toBeLessThan(bx);
});

for (const [b, you, alex] of [
  ['A', 'Could you tell me which part you would like to revisit?', 'The structure is promising. I would like clearer evidence for the proposed timeline.'],
  ['B', 'I feel uneasy hearing that. Could you explain what needs changing?', 'I understand. My main concern is that we have not discussed the revised requirements yet.'],
] as const) {
  test(`T0${b === 'A' ? 6 : 7} branch ${b}: approved dialogue, captions and persistent label`, async ({ page }) => {
    await boot(page);
    await toHeld(page);
    // Record every caption the participant actually sees (fast mode changes lines quickly).
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="caption"]')!;
      (window as any).__caps = [];
      new MutationObserver(() => {
        const t = el.textContent ?? '';
        const caps = (window as any).__caps as string[];
        if (!(el as HTMLElement).hidden && caps.at(-1) !== t) caps.push(t);
      }).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    });
    await explore(page, b);
    await expect(page.getByTestId('hyp-badge')).toContainText(`Hypothetical · Path ${b}`);
    await expect.poll(async () => (await session(page)).branchStep).toBe(2);
    await expect(page.getByTestId('caption')).toContainText(alex);
    const caps = (await page.evaluate(() => (window as any).__caps)) as string[];
    const youIdx = caps.findIndex((c) => c.includes(you));
    const alexIdx = caps.findIndex((c) => c.includes(alex));
    expect(youIdx).toBeGreaterThanOrEqual(0);
    expect(alexIdx).toBeGreaterThan(youIdx);
    expect(caps[youIdx]).toContain('You · hypothetical line');
    expect(caps[alexIdx]).toContain('Alex · fictional continuation');
    await expect(page.getByTestId('hyp-badge')).toContainText(`Hypothetical · Path ${b}`);
  });
}

test('T08 restore repeat: A → R → B → R → A → R restores the exact original (data and 3D)', async ({ page }) => {
  test.slow(); // long journey; software (SwiftShader) rendering is slow in CI
  await boot(page);
  await toHeld(page);
  const baseline = await inspect(page);
  for (const b of ['A', 'B', 'A'] as const) {
    await explore(page, b);
    await expect.poll(async () => (await session(page)).branchStep, { timeout: 15_000 }).toBe(2);
    await desk(page, 'RECOMPOSE').click();
    await expect(page.getByTestId('state-note')).toContainText('Original moment restored'); // brief confirmation
    await expect(page.getByTestId('ro-restore-data')).toContainText('PASS');
    await expect(page.getByTestId('ro-restore-3d')).toContainText('PASS', { timeout: 20_000 });
    const now = await inspect(page);
    const { settled: _s1, ...alexNow } = now.alex as Record<string, unknown>;
    const { settled: _s2, ...alexBase } = baseline.alex as Record<string, unknown>;
    expect(alexNow).toEqual(alexBase);
    expect(now.camera).toEqual(baseline.camera);
    expect(now.landmarks).toEqual(baseline.landmarks);
  }
  await expect(page.getByTestId('ro-visited')).toHaveText('Path A, Path B');
});

test('T09 safety: Pause and Leave in every live state, including while disconnected', async ({ page }) => {
  test.slow(); // long journey; software (SwiftShader) rendering is slow in CI
  await boot(page);
  await toM01(page);
  const steps: Array<() => Promise<void>> = [
    async () => {},
    async () => desk(page, 'HOLD').click(),
    async () => desk(page, 'UNFOLD').click(),
    async () => {
      await page.getByTestId('path-B').click();
      await desk(page, 'BEGIN_BRANCH').click();
    },
    async () => desk(page, 'RECOMPOSE').click(),
  ];
  for (const step of steps) {
    await step();
    const ph = await phase(page);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await expect(page.getByTestId('leave-overlay')).toBeVisible();
    await page.getByTestId('resume').click();
    await expect(page.getByTestId('pause-overlay')).toBeHidden();
    expect(await phase(page)).toBe(ph);
  }
  // now disconnected AND paused: Leave still works immediately
  await desk(page, 'DROP').click();
  await expect(page.getByTestId('pause-overlay')).toContainText('Connection to your therapist was lost');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-overlay')).toContainText('Paused');
  await page.getByTestId('leave-overlay').click();
  await expect(page.getByTestId('screen-left')).toBeVisible();
  expect(await phase(page)).toBe('LEFT');
});

test('T10 invalid commands are rejected and do not corrupt state', async ({ page }) => {
  test.slow(); // long journey; software (SwiftShader) rendering is slow in CI
  await boot(page);
  await toM01(page);
  await rawSend(page, 'RECOMPOSE'); // early
  await expect(page.getByTestId('desk-notice')).toContainText('RECOMPOSE rejected');
  await rawSend(page, 'UNFOLD'); // wrong state
  await expect(page.getByTestId('desk-notice')).toContainText('UNFOLD rejected');
  await desk(page, 'HOLD').click();
  const snap = (await session(page)).snapshot;
  await page.getByTestId('raw-dup').click(); // same eventId again
  await expect(page.getByTestId('desk-notice')).toContainText('duplicate');
  await rawSend(page, 'HOLD');
  await expect(page.getByTestId('desk-notice')).toContainText('HOLD rejected');
  expect((await session(page)).snapshot).toEqual(snap);
  await explore(page, 'A');
  await rawSend(page, 'BEGIN_BRANCH'); // duplicate begin
  await expect(page.getByTestId('desk-notice')).toContainText('BEGIN_BRANCH rejected');
  const s = await session(page);
  expect(s.visited).toEqual(['A']);
  expect(s.phase).toBe('EXPLORING');
});

test('T11 disconnect mid-Explore halts; reconnect + explicit resume required', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  await explore(page, 'A');
  await desk(page, 'DROP').click();
  await expect(page.getByTestId('pause-overlay')).toContainText('Connection to your therapist was lost');
  const step = (await session(page)).branchStep;
  await page.waitForTimeout(1500);
  expect((await session(page)).branchStep).toBe(step); // nothing progressed
  await desk(page, 'CONNECT').click();
  await expect(page.getByTestId('pause-overlay')).toContainText('reconnected');
  await page.waitForTimeout(1000);
  expect((await session(page)).branchStep).toBe(step); // still halted
  await expect(desk(page, 'RECOMPOSE')).toBeDisabled();
  await desk(page, 'RESUME_SESSION').click();
  await expect(page.getByTestId('pause-overlay')).toBeHidden();
  await expect.poll(async () => (await session(page)).branchStep).toBe(2);
});

test('T12 reflection shows only visited paths, once each', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  await explore(page, 'B');
  await desk(page, 'RECOMPOSE').click();
  await explore(page, 'B');
  await desk(page, 'RECOMPOSE').click();
  await desk(page, 'REFLECT').click();
  await expect(page.getByTestId('screen-reflection')).toBeVisible();
  await expect(page.getByTestId('reflect-B')).toHaveCount(1);
  await expect(page.getByTestId('reflect-A')).toHaveCount(0);
  await expect(page.getByTestId('screen-reflection')).not.toContainText(/healthy|defensive|avoidant|correct response|success|score/i);
});

test('T12b early end needs a justification and shows the empty state', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  await desk(page, 'REFLECT').click();
  await expect(page.getByTestId('desk-notice')).toContainText('justification');
  await page.getByTestId('desk-justification').fill('Participant asked to stop');
  await desk(page, 'REFLECT').click();
  await expect(page.getByTestId('reflect-empty')).toBeVisible();
});

test('T13 accessibility baseline: keyboard-only, captions, caption size, reduced motion, high contrast', async ({ page }) => {
  await boot(page);
  // keyboard only through the participant screens
  await expect(page.getByTestId('enter')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByTestId('ack').focus();
  await page.keyboard.press('Space');
  await page.getByTestId('continue').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ready')).toBeFocused();
  await page.keyboard.press('Enter');
  await desk(page, 'CONNECT').click();
  await desk(page, 'START').click();
  await page.waitForFunction(() => (window as any).__tr.session().m01Reached);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-overlay')).toBeVisible();
  await expect(page.getByTestId('resume')).toBeFocused();
  // settings in pause menu
  await page.locator('.pause-settings summary').click();
  const cap = page.getByTestId('caption');
  await page.getByTestId('capsize-L').check();
  await page.getByTestId('set-highContrast').check();
  await page.getByTestId('set-reducedMotion').check();
  await expect(page.getByTestId('set-reducedMotion')).toBeFocused(); // focus kept after toggling
  await page.getByTestId('resume').click();
  const view = page.getByTestId('participant-view');
  await expect(view).toHaveClass(/hc/);
  await expect(view).toHaveClass(/rm/);
  await expect(view).toHaveAttribute('data-caption-size', 'L');
  await expect(cap).toBeVisible();
  // captions off hides captions
  await page.getByTestId('pause').click();
  await page.locator('.pause-settings summary').click();
  await page.getByTestId('set-captions').uncheck();
  await page.getByTestId('resume').click();
  await expect(cap).toBeHidden();
  // reduced motion: panels appear by short fade, no rise
  await desk(page, 'HOLD').click();
  await desk(page, 'UNFOLD').click();
  await page.waitForTimeout(400);
  expect((await inspect(page)).panels).toEqual({ A: 1, B: 1 });
  // keyboard selection of a path
  await page.getByTestId('path-A').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('path-A')).toHaveAttribute('aria-pressed', 'true');
  // target sizes >= 48px for participant buttons
  for (const id of ['pause', 'leave']) {
    const bb = (await page.getByTestId(id).boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(48);
    expect(bb.width).toBeGreaterThanOrEqual(48);
  }
});

test('T14 deliverability: runs from the local build with no external network requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
  });
  await boot(page);
  await toHeld(page);
  await explore(page, 'A');
  await desk(page, 'RECOMPOSE').click();
  await desk(page, 'REFLECT').click();
  await expect(page.getByTestId('screen-reflection')).toBeVisible();
  expect(external).toEqual([]);
});

test('Participant view never contains clinician controls', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  await desk(page, 'UNFOLD').click();
  const inside = await page.getByTestId('participant-view').locator('[data-testid^="desk-"]').count();
  expect(inside).toBe(0);
  for (const label of ['Hold', 'Unfold', 'Recompose', 'Begin path', 'Reflect', 'Start']) {
    await expect(page.getByTestId('participant-view').getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
});

test('Separate-window Director Desk drives the participant; closing it counts as link loss', async ({ context }) => {
  const p = await context.newPage();
  await p.goto('/?view=participant&fast&session=sep-1');
  await p.getByTestId('enter').click();
  await p.getByTestId('ack').check();
  await p.getByTestId('continue').click();
  await p.getByTestId('ready').click();
  const d = await context.newPage();
  await d.goto('/?view=desk&session=sep-1');
  await expect(d.getByTestId('desk-window-status')).toContainText('Connected to participant view');
  await d.getByTestId('desk-CONNECT').click();
  await expect(d.getByTestId('desk-START')).toBeEnabled();
  await d.getByTestId('desk-START').click();
  await expect.poll(() => phase(p)).toBe('CONVERSATION');
  await p.waitForFunction(() => (window as any).__tr.session().m01Reached);
  await expect(d.getByTestId('desk-HOLD')).toBeEnabled();
  await d.getByTestId('desk-HOLD').click();
  await expect.poll(() => phase(p)).toBe('HELD');
  await d.close();
  await expect(p.getByTestId('pause-overlay')).toContainText('Connection to your therapist was lost', { timeout: 6000 });
  await expect(p.getByTestId('leave-overlay')).toBeVisible();
});

// ---------------- VR in-world UI (desktop preview with ?vrui, real mouse rays) ----------------
async function vrClick(p: Page, panel: string, id: string) {
  const box = (await p.locator('.scene-canvas').boundingBox())!;
  await expect
    .poll(async () => p.evaluate(([a, b]) => (window as any).__tr.vrui.buttonScreenPoint(a, b), [panel, id]), { timeout: 15_000 })
    .not.toBeNull();
  const pt = await p.evaluate(([a, b]) => (window as any).__tr.vrui.buttonScreenPoint(a, b), [panel, id]);
  await p.mouse.move(box.x + pt.x, box.y + pt.y);
  await p.mouse.click(box.x + pt.x, box.y + pt.y);
}

test('VR UI: full journey by pointing at in-world panels (ray hit-testing)', async ({ page }) => {
  test.slow();
  await page.goto('/?fast&vrui');
  await expect.poll(() => phase(page)).toBe('WELCOME');
  await vrClick(page, 'main', 'enter');
  await expect.poll(() => phase(page)).toBe('PREPARE');
  await vrClick(page, 'main', 'continue'); // disabled until acknowledged
  expect(await phase(page)).toBe('PREPARE');
  await vrClick(page, 'main', 'set-highContrast');
  await expect.poll(async () => (await session(page)).settings.highContrast).toBe(true);
  await vrClick(page, 'main', 'ack');
  await vrClick(page, 'main', 'continue');
  await vrClick(page, 'main', 'ready');
  await desk(page, 'CONNECT').click();
  await desk(page, 'START').click();
  await page.waitForFunction(() => (window as any).__tr.session().m01Reached);
  await desk(page, 'HOLD').click();
  await desk(page, 'UNFOLD').click();
  await settled(page);
  await vrClick(page, 'B', 'path-B');
  await expect.poll(async () => (await session(page)).selection).toBe('B');
  await desk(page, 'BEGIN_BRANCH').click();
  await expect.poll(() => phase(page)).toBe('EXPLORING');
  await vrClick(page, 'ret', 'return');
  await expect.poll(async () => (await session(page)).returnRequested).toBe(true);
  await vrClick(page, 'safety', 'pause');
  await expect.poll(async () => (await session(page)).participantPaused).toBe(true);
  await vrClick(page, 'main', 'resume');
  await expect.poll(async () => (await session(page)).participantPaused).toBe(false);
  await desk(page, 'RECOMPOSE').click();
  await expect(page.getByTestId('ro-restore-3d')).toContainText('PASS', { timeout: 20_000 });
  await vrClick(page, 'safety', 'leave');
  await expect.poll(() => phase(page)).toBe('LEFT');
  // in-world UI never contains clinician commands
  const ids = await page.evaluate(() => Object.values((window as any).__tr.vrui.panels).flatMap((p: any) => p.buttonIds.map((b: any) => b.id)));
  for (const forbidden of ['START', 'HOLD', 'UNFOLD', 'BEGIN_BRANCH', 'RECOMPOSE', 'REFLECT', 'END']) expect(ids).not.toContain(forbidden);
});

test('VR UI: link loss shows the in-world notice with Leave, and no path choice', async ({ page }) => {
  await page.goto('/?fast&vrui');
  await vrClick(page, 'main', 'enter');
  await vrClick(page, 'main', 'ack');
  await vrClick(page, 'main', 'continue');
  await vrClick(page, 'main', 'ready');
  await desk(page, 'CONNECT').click();
  await desk(page, 'START').click();
  await page.waitForFunction(() => (window as any).__tr.session().m01Reached);
  await desk(page, 'HOLD').click();
  await desk(page, 'UNFOLD').click();
  await desk(page, 'DROP').click();
  const visible = await page.evaluate(() => {
    const P = (window as any).__tr.vrui.panels;
    return { main: P.main.mesh.visible, A: P.A.mesh.visible, B: P.B.mesh.visible, buttons: P.main.buttonIds.map((b: any) => b.id) };
  });
  expect(visible.main).toBe(true);
  expect(visible.A).toBe(false);
  expect(visible.B).toBe(false);
  expect(visible.buttons).toContain('leave-overlay');
  await vrClick(page, 'main', 'leave-overlay');
  await expect.poll(() => phase(page)).toBe('LEFT');
});

// ---------------- cross-device Desk via the WebSocket relay ----------------
test('Relay: Desk on another "device" joins by code, drives Hold, and closing it halts the scene', async ({ browser }) => {
  test.slow();
  const relay = 'ws://localhost:8787';
  const pc = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dc = await browser.newContext({ viewport: { width: 520, height: 900 } });
  const p = await pc.newPage();
  await p.goto(`/?view=participant&fast&relay=${encodeURIComponent(relay)}`);
  await p.getByTestId('enter').click();
  await p.getByTestId('ack').check();
  await p.getByTestId('continue').click();
  await p.getByTestId('ready').click();
  const code = new URL(p.url()).searchParams.get('session')!;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(p.getByTestId('wait-code')).toContainText(code);
  const d = await dc.newPage();
  await d.goto(`/?view=desk&relay=${encodeURIComponent(relay)}`);
  await d.getByTestId('desk-code').fill(code.toLowerCase());
  await d.keyboard.press('Enter');
  await expect(d.getByTestId('desk-window-status')).toContainText('Connected to participant view', { timeout: 15_000 });
  await d.getByTestId('desk-CONNECT').click();
  await expect(d.getByTestId('desk-START')).toBeEnabled({ timeout: 15_000 });
  await d.getByTestId('desk-START').click();
  await p.waitForFunction(() => (window as any).__tr.session().m01Reached, null, { timeout: 20_000 });
  await expect(d.getByTestId('desk-HOLD')).toBeEnabled({ timeout: 15_000 });
  await d.getByTestId('desk-HOLD').click();
  await expect.poll(() => phase(p)).toBe('HELD');
  await dc.close();
  await expect(p.getByTestId('pause-overlay')).toContainText('Connection to your therapist was lost', { timeout: 10_000 });
  await pc.close();
});

// ---------------- Visual lock v1 release checks ----------------
test('Visual lock: path zones show focus, selected, explored and unavailable states; Pause/Leave stay reachable mid-transition', async ({ page }) => {
  test.slow();
  await boot(page);
  await toHeld(page);
  await expect(page.getByTestId('state-note')).toBeHidden(); // no floating side card while held
  await desk(page, 'UNFOLD').click();
  // during the crossfade the safety controls are still there
  await expect(page.getByTestId('pause')).toBeVisible();
  await expect(page.getByTestId('leave')).toBeVisible();
  await settled(page);
  // focus
  await page.getByTestId('path-A').focus();
  await expect(page.getByTestId('path-A')).toBeFocused();
  // selected
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('path-A-state')).toHaveText('Selected');
  await expect(page.getByTestId('path-A')).toHaveAttribute('aria-pressed', 'true');
  // explored (after visiting A and coming back)
  await desk(page, 'BEGIN_BRANCH').click();
  await expect(page.getByTestId('hyp-badge')).toContainText('Hypothetical · Path A');
  await expect(page.getByTestId('request-return')).toBeVisible();
  await expect(page.getByTestId('pause')).toBeVisible();
  await desk(page, 'RECOMPOSE').click();
  await desk(page, 'UNFOLD').click();
  await settled(page);
  await expect(page.getByTestId('path-A-state')).toHaveText('Explored ✓');
  await expect(page.getByTestId('path-B-state')).toBeHidden();
  // unavailable while the link is down
  await desk(page, 'DROP').click();
  await expect(page.getByTestId('path-A')).toBeDisabled();
  await expect(page.getByTestId('path-A-state')).toHaveText('Unavailable');
});

test('Visual lock: no overlap between caption and Pause/Leave/Return while exploring', async ({ page }) => {
  await boot(page);
  await toHeld(page);
  await explore(page, 'B');
  await expect.poll(async () => (await session(page)).branchStep).toBe(2);
  const boxes = await Promise.all(['caption', 'pause', 'leave', 'request-return', 'hyp-badge'].map((id) => page.getByTestId(id).boundingBox()));
  const overlap = (a: any, b: any) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${i}/${j}`).toBe(false);
  // caption stays within 3 lines
  const lines = await page.locator('.caption-text').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
});

test('Visual lock: jury capture has no test harness or open debug log; Desk shows state + permitted commands', async ({ page }) => {
  await page.goto('/?fast');
  await expect(page.getByTestId('desk-harness')).toHaveCount(0);
  await expect(page.getByTestId('raw-send')).toHaveCount(0);
  expect(await page.getByTestId('desk-diagnostics').evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  await page.getByTestId('enter').click();
  await page.getByTestId('ack').check();
  await page.getByTestId('continue').click();
  await page.getByTestId('ready').click();
  await desk(page, 'CONNECT').click();
  await expect(page.getByTestId('desk-link')).toHaveText('Connected');
  await expect(page.getByTestId('desk-phase')).toHaveText('Session: Waiting to start');
  await expect(desk(page, 'START')).toBeEnabled();
  await expect(desk(page, 'HOLD')).toBeDisabled();
  await desk(page, 'START').click();
  await page.waitForFunction(() => (window as any).__tr.session().m01Reached);
  await desk(page, 'HOLD').click();
  await expect(page.getByTestId('desk-phase')).toHaveText('Session: Moment held');
  await expect(desk(page, 'UNFOLD')).toBeEnabled();
  await expect(desk(page, 'RECOMPOSE')).toBeDisabled();
});
