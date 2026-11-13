# Therapeutic Realms — The Living Scene

Research prototype · desktop + WebXR (VR) · **not clinically validated**

This builds the Living Scene interaction from the V3 developer handoff (19 Oct 2026) as a web app. It covers one warm room, seen from a fixed seat. Alex is a fictional colleague. A separate Director Desk lets the clinician **Hold**, **Unfold**, **Explore** and **Recompose** a single conversation moment. The participant can **Pause** or **Leave** at any time, on desktop or in a VR headset.

> **Engine:** the manual recommends Unity 6.3. This build uses **TypeScript + Three.js + Vite + WebXR**, agreed with Shiva on 13 Nov 2026. The manual (section 11) asks for documented approval of an alternative, so the designer still has to sign this change off. All logic uses the manual's state names and event names (section 12).
>
> **VR status:** VR mode is built and tested with a desktop preview and simulated ray input. **It has not yet been tested in a physical headset.** The manual requires at least 3 in-headset runs before calling it working VR.

## Try it

- **Hosted:** GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` on every push to `main`. The URL is listed in the repo's *Settings → Pages*.
- **Locally:**
  ```bash
  npm install
  npm run build
  npm run preview          # http://localhost:4173  — works offline
  ```

### Views

| URL | What you get |
|---|---|
| `/` | Desktop demo. Participant view (left) + Director Desk (right, outside the participant frame). |
| `/?view=participant` | Participant view only. **Use this in the headset.** Press **Enter VR** (shown only where WebXR VR is available). |
| `/?view=desk` | Director Desk only. Asks for the session code shown on the participant's Waiting screen and in the page header. |
| `&relay=wss://…` | Connect Desk and participant through the WebSocket relay, so they can be on **different devices**. Without it they can only talk within one browser. |
| `&session=CODE` | Pair a participant view and a Desk directly |
| `&vrui` | Desktop preview of the in-world VR panels (no headset needed) |
| `&fps` | Frame-time readout in VR |
| `&fast` | Short line timings (automated tests) |

### Running a VR session (headset + laptop)

1. Deploy the relay once (see below) and note its `wss://` URL.
2. **Headset** (e.g. Meta Quest Browser): open `https://<pages-url>/?view=participant&relay=wss://<relay>`. Note the session code in the header, then press **Enter VR**.
3. **Laptop:** open `https://<pages-url>/?view=desk&relay=wss://<relay>` and type the code.
4. Run the session from the Desk. In the headset, point the controller and pull the trigger to select. **Squeeze the grip to pause.** Hand-tracking pinch also selects.
5. If the laptop closes or the network drops, the headset halts the scene within about 4 s. Pause and Leave keep working. The clinician must reconnect and press **Resume session**.

If `VITE_RELAY_URL` is set at build time (a repo variable `RELAY_URL` for the Pages workflow), the `&relay=` part can be left out.

### The relay (for headset sessions)

`relay/server.mjs` is a ~80-line Node WebSocket server. It pairs clients by session code and forwards messages between them. It stores nothing.

```bash
cd relay && npm install && npm start      # listens on $PORT (default 8787)
```

Deploy it anywhere that runs Node and supports WebSockets (Railway, Render, Fly.io). Set `ALLOWED_ORIGINS=https://shivashanmukh.github.io` to refuse other sites. Pages is served over HTTPS, so the relay must be reached via `wss://`.

## How it is built

```
src/core/          pure TypeScript, no DOM, fully unit-tested
  machine.ts       SessionStateMachine: dispatch(session, envelope) → accepted / rejected + reason
  snapshot.ts      deep-frozen snapshot at M01, exact restore, field-by-field diff
  store.ts         live session, event envelopes, line-timing playback
  transport.ts     Desk ↔ participant link: BroadcastChannel or WebSocket relay
  scenario.ts      the one canonical dialogue source (Scenario01_Canonical.json)
src/view3d/        Three.js room, stylised Alex, panels, lights; seat rig; shared pointer system
src/vr/            WebXR session + controllers (xr.ts), in-world UI panels (vrui.ts, canvasPanel.ts)
src/ui/            desktop participant overlays, Director Desk, styles (placeholder UI)
relay/             WebSocket relay server
tests/ e2e/        Vitest unit tests, Playwright end-to-end tests
qa/ evidence/      QA report, test logs, screenshots, walkthrough video
```

Key decisions:

- **One rulebook.** Every press becomes an event envelope `{sessionId, eventId, actor, type, stateExpected, anchorId, timestampMs}`. A wrong actor, session, state or anchor, a duplicate id, a disconnected clinician, a halted link or a paused participant gets a rejection with a reason, and nothing changes.
- **Snapshot at M01.** HOLD copies the scene once and deep-freezes it. RECOMPOSE restores a fresh copy. Explored-path history is stored separately. Alex's pose is a pure function of `(pose, animTime)`, so the frozen frame comes back exactly. The Desk shows a live data check and a 3D check after every restore.
- **The seat never moves.** On desktop the camera is fixed. In VR the headset uses a `local` reference space inside a fixed seat rig: head-tracking works, but nothing moves you. The system recentre resets it.
- **One pointer system** for mouse, controller rays and hand pinch. Every selectable thing (path panels, in-world buttons) goes through it.
- **Safety is independent.** Pause, Resume and Leave never depend on the clinician link.
- **VR comfort and performance.** UI sits about 1 m away and slightly below gaze. Pause/Leave are world-anchored at armrest height, not stuck to your head. The original quote and path labels stay on the room geometry they belong to. Fixed foveation is on, and shadows refresh every 6th frame in VR.

## Tests

```bash
npm test                 # unit tests (Vitest)
npm run build && npm run test:e2e
# use an installed Chrome instead of Playwright's bundled one:
CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
```

The end-to-end config starts the preview server and a local relay. See `qa/QA_REPORT.md` for results and known limitations.

## Not in scope / honest limits

- **Not yet tested in a physical headset.** No frame-rate measurement on a device and no comfort testing.
- Placeholder UI. The designer's Figma exports should replace `src/ui/styles.css` and the VR panel drawing, mapped through the asset manifest IDs.
- Alex is built from simple shapes, with procedural poses and no lip-sync. Optional spoken lines use the browser's built-in voice. Captions carry every line.
- The relay has no authentication beyond the session code. That's fine for a fictional-content prototype; it's not acceptable for real clinical use.
- No clinical, usability or accessibility conformance claims.

## Licences

Code written for this project. Runtime and build dependencies: Three.js (MIT), Vite (MIT), ws (MIT). All textures and the skyline are drawn procedurally at runtime, so there are no third-party art, audio or font assets.
