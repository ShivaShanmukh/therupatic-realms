# QA report — The Living Scene (web 3D + WebXR prototype)

- **Build:** web build of 25 Nov 2026 with Visual lock v1 applied, from `npm run build` (Vite 8, Three.js 0.187, TypeScript)
- **Platform tested:** Linux, Google Chrome headless with SwiftShader software WebGL, 1600×900. No GPU and no headset.
- **Scope:** desktop behaviour, plus the VR in-world UI driven by simulated rays in a desktop preview. **No physical headset has been used.** These results say nothing about in-headset rendering, frame rate, comfort, usability, clinical safety, accessibility conformance or therapeutic effect.

## Test runs

| Suite | Result |
|---|---|
| Unit (Vitest, `tests/machine.test.ts`): state machine, snapshot, rules | **24 / 24 passed** |
| End-to-end (Playwright, `e2e/flow.spec.ts`) on the built app, incl. local relay | **23 / 23 passed** in one clean run, 13.0 min (`e2e-run.log`). After it, two Desk-only tweaks (alert colour, "Begin A" label); the 3 affected tests were re-run and pass. |

## Acceptance matrix (manual section 17)

| ID | Test | How it was checked | Result |
|---|---|---|---|
| T01 | Entry | Continue disabled until acknowledgement. START rejected until participant Ready. Participant cannot send START. | **Pass** |
| T02 | Start | START rejected while disconnected (reason "clinician is disconnected"), accepted once connected + ready | **Pass** |
| T03 | Canonical line | Exact string in the conversation caption, Hold quote, Unfold quote ("unchanged"), Recompose quote and Reflection | **Pass** |
| T04 | Hold | Rejected before M01 finishes. At M01: pose `held`, live 3D values identical 1.5 s apart (frozen frame), no path options, snapshot anchor M01 | **Pass** |
| T05 | Unfold | Landmark world positions (window, table, mug, plant, chair, lamp) and camera identical before and after. Both panels fully revealed, A left / B right, labelled "Hypothetical · Path A/B". Original quote stays visible. | **Pass** |
| T06 | Branch A | Recorded caption sequence: participant line then Alex line, both tagged "Hypothetical · Path A". Persistent badge. | **Pass** |
| T07 | Branch B | Same for B, with different approved dialogue | **Pass** |
| T08 | Restore repeat | A → R → B → R → A → R. Each time: data diff = 0 fields; 3D check passes (Alex pose values, lights, panels, ring, camera, landmarks vs HELD baseline); same frozen snapshot object; history = A, B | **Pass** |
| T09 | Safety | Pause → overlay → Resume returns to the same phase in CONVERSATION, HELD, UNFOLDED, EXPLORING and RECOMPOSED. Then link dropped + Esc pause → Leave works immediately. | **Pass** (on re-run, see note) |
| T10 | Invalid commands | Early Recompose, wrong-state Unfold, duplicate eventId, second Hold and duplicate Begin are all rejected with reasons. Snapshot and history unchanged. | **Pass** |
| T11 | Disconnection | Link loss mid-Explore stops playback. Reconnect alone leaves it halted and Recompose disabled. Clinician Resume Session continues it. | **Pass** |
| T12 | Reflection | B explored twice → Reflection lists Path B once and no A. No judgemental wording. Early end needs a justification and shows the empty state. | **Pass** |
| T13 | Accessibility baseline | Keyboard-only path through Welcome/Prepare/Waiting. Esc pauses and focus moves to Resume. Focus kept when toggling settings. Large captions, high contrast, reduced motion, captions-off all apply. Paths selectable with Enter. Pause/Leave targets ≥ 48 px. | **Pass** (baseline only, not a WCAG audit) |
| T14 | Deliverability | Full flow on the local build with zero non-local network requests | **Pass** (served by local static server, not `file://`) |
| — | Clinician controls never in participant view | No desk controls or clinician-command buttons inside the participant frame | **Pass** |
| — | VR in-world UI (`?vrui` preview) | Whole journey done by real mouse rays hitting in-world panel buttons: Enter, settings, acknowledgement gate, Ready, choose Path B on the panel, Request return, Pause/Resume, Leave. 3D restore check passes. No clinician commands exist on any in-world panel. | **Pass** |
| — | VR link loss | Link dropped while unfolded → in-world notice with Leave. Path labels hidden. Leave works. | **Pass** |
| — | Cross-device Desk (relay) | Two isolated browser contexts. Desk joins by 6-character code over the WebSocket relay and drives Start/Hold. Closing the Desk halts the participant in about 4 s. | **Pass** |
| — | Separate-window Director Desk | Desk window drives Start/Hold over BroadcastChannel. Closing it → participant shows link lost within the heartbeat window, Leave available. | **Pass** |

## Evidence

- `evidence/screenshots/default__*`: every state, from Welcome to Reflection, plus selected path, pause overlay and link lost
- `evidence/screenshots/high-contrast__*`, `reduced-motion__*`, `captions-off__*`, `captions-large__*`: visual variants
- `evidence/video/demo_87s_1.25x.mp4`: clean walkthrough, sped up 1.25×
- `evidence/video/walkthrough_uncut_109s.mp4`: the same run at real speed. Every state change in it is caused by a real Desk click (Playwright clicking), not a scripted video.
- `qa/e2e-run.log`, `qa/e2e-T09-rerun.log`, `qa/unit-results.txt`

## Known limitations

1. **Not Unity.** The engine change from the manual's Unity 6.3 recommendation needs the designer's documented approval.
1a. **VR not yet verified in a headset.** WebXR session start, controller tracking, foveation and frame rate on a real device are untested. The in-world UI and ray input were tested only in a desktop preview. Manual gate D requires at least 3 in-headset runs with measurements before any VR claim.
2. **Software rendering only.** Tested in Chrome with SwiftShader. Not yet tested on real GPUs, Safari, Firefox or Windows/macOS. Frame rate has not been measured.
3. **Placeholder UI.** No approved Figma exports were supplied. Asset manifest items P01–P08, SAFE and D01 are all still placeholders.
4. **Alex is stylised.** Alex is built from simple shapes with procedural poses and has no lip-sync or facial animation. The optional voice uses the browser's built-in text-to-speech, which varies by device. No licensed voice clips.
5. **Desk link:** same-browser (BroadcastChannel), or cross-device through the WebSocket relay. The relay is tested locally only. It is not yet deployed and has no authentication beyond the session code.
6. **Accessibility:** T13 is a functional baseline. No full WCAG 2.2 AA audit has been done (screen reader pass, contrast measurement across all states, zoom/reflow). Reduced motion is a setting inside the app; the OS-level preference only affects CSS transitions.
7. **Line timing** uses reading-time estimates, not audio timecodes.
8. **Not done yet:** clinician walkthrough, user testing, comfort testing (manual gates D and E).

## Visual lock v1 — release checklist (25 Nov 2026)

| Check | Evidence | Status |
|---|---|---|
| Hold → Unfold → A → Recompose → B → Recompose works | T08 (A → R → B → R → A → R) | **Pass** |
| Original quote, camera, room and avatar pose match after every restore | T08: data diff = 0, 3D check passes after each restore; T03 quote | **Pass** |
| Pause / Leave work during animations, dialogue and link interruption | T09 (every live state + link loss); visual-lock test (mid-crossfade) | **Pass** |
| Path A/B have focus, selected, explored and unavailable states | Visual-lock test: keyboard focus, Enter selects, "Explored ✓" after a visit, "Unavailable" while the link is lost | **Pass** |
| Headset text + input actually tested; device + issues reported | **Not done.** Only the desktop preview (`&vrui`) with simulated rays. Needs Shiva on a real headset. | **Open** |
| Desk displays state + permitted commands; developer logs stay available | Visual-lock test: link pill, "Session: …", only permitted buttons enabled; log under Diagnostics | **Pass** |
| No console/test harness or debug overlays in the jury capture | Visual-lock test: no harness without `&dev`, Diagnostics collapsed. Record without `&dev`, `&fps` or `&vrui`. | **Pass** |
| Caption ≤ 3 lines and no overlap with Pause/Leave/Return/label | Visual-lock test: bounding boxes don't intersect; caption ≤ 3 lines | **Pass** |

Label change: path labels now read **Ask for clarity** (A) and **Share a view** (B), per the visual-lock PDF. Updated in `Scenario01_Canonical.json`; the dialogue is unchanged.
