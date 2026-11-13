// Shared types for The Living Scene.
// The state names and event names follow the data contract in the
// Developer Implementation Manual V3, section 12.

export type BranchId = 'A' | 'B';

export type Phase =
  | 'WELCOME'
  | 'PREPARE'
  | 'WAITING'
  | 'CONVERSATION'
  | 'HELD'
  | 'UNFOLDED'
  | 'EXPLORING'
  | 'RECOMPOSED'
  | 'REFLECTION'
  | 'ENDED' // clinician ended the session
  | 'LEFT'; // participant left the session

export type Actor = 'participant' | 'clinician' | 'system';

export type EventType =
  // participant
  | 'ENTER'
  | 'SAVE_SETTINGS'
  | 'ACKNOWLEDGE'
  | 'CONTINUE'
  | 'READY'
  | 'PAUSE'
  | 'RESUME'
  | 'SELECT'
  | 'DESELECT'
  | 'REQUEST_RETURN'
  | 'LEAVE'
  // clinician
  | 'CONNECT'
  | 'START'
  | 'HOLD'
  | 'UNFOLD'
  | 'BEGIN_BRANCH'
  | 'RECOMPOSE'
  | 'RESUME_SESSION'
  | 'REFLECT'
  | 'END'
  // system
  | 'DISCONNECT'
  | 'ADVANCE';

export interface EventEnvelope {
  sessionId: string;
  eventId: string;
  actor: Actor;
  type: EventType;
  stateExpected?: Phase;
  anchorId?: string;
  timestampMs: number;
  payload?: Record<string, unknown>;
}

export type Vec3 = [number, number, number];

export type AlexPose = 'idle' | 'speaking' | 'listening' | 'held';

export interface Caption {
  speaker: 'Context' | 'Alex' | 'You';
  text: string;
  /** context = scene-setting note, dialogue = live line, original = the M01 line, hypothetical = branch line */
  kind: 'context' | 'dialogue' | 'original' | 'hypothetical';
  branch: BranchId | null;
}

/** Everything the 3D view needs to draw one frame of the room. */
export interface SceneState {
  caption: Caption | null;
  alex: {
    pose: AlexPose;
    /** Seconds into Alex's procedural animation. Frozen while pose === 'held'. */
    animTime: number;
    position: Vec3;
    rotationY: number;
  };
  lighting: {
    key: number;
    lamp: number;
    /** 0 = normal room, 1 = fully dimmed edges. Never used to hide the room. */
    peripheralDim: number;
    /** Subtle rim-light tint while exploring a path. Always paired with a text label. */
    tint: BranchId | null;
  };
  camera: { position: Vec3; target: Vec3 };
  anchor: { ring: boolean; quote: boolean };
  panels: { A: boolean; B: boolean };
  hypotheticalLabel: BranchId | null;
}

export interface Settings {
  captions: boolean;
  captionSize: 'S' | 'M' | 'L';
  reducedMotion: boolean;
  highContrast: boolean;
  volume: number; // 0..1
  voice: boolean; // browser text-to-speech placeholder
}

/** The immutable copy taken once at HOLD (anchor M01). */
export interface Snapshot {
  anchorId: string;
  scenarioId: string;
  takenAtEventId: string;
  lineIndex: number;
  timecodeMs: number;
  scene: SceneState;
}

export interface LogEntry {
  eventId: string;
  actor: Actor;
  type: EventType;
  accepted: boolean;
  reason?: string;
  phase: Phase;
  timestampMs: number;
}

export interface Session {
  sessionId: string;
  scenarioId: string;
  phase: Phase;
  settings: Settings;
  acknowledged: boolean;
  participantReady: boolean;
  clinicianConnected: boolean;
  /** Participant chose to pause. Only the participant can clear it. */
  participantPaused: boolean;
  /** Clinician link dropped mid-session. Needs reconnect AND clinician RESUME_SESSION. */
  linkHalted: boolean;
  lineIndex: number; // -1 before start
  m01Reached: boolean;
  selection: BranchId | null;
  activeBranch: BranchId | null;
  branchStep: number; // 0 = participant line, 1 = Alex reply, 2 = done
  returnRequested: boolean;
  /** Explored-path history. Separate from the snapshot. Each path at most once. */
  visited: BranchId[];
  snapshot: Snapshot | null;
  scene: SceneState;
  restoreCount: number;
  earlyEndJustification: string | null;
  seenEventIds: string[];
  log: LogEntry[];
}

export interface DispatchResult {
  session: Session;
  accepted: boolean;
  reason?: string;
}
