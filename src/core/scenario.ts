// One canonical dialogue source. Everything that shows a line reads it from here.
import raw from './scenario01.json';
import type { BranchId } from './types';

export interface Branch {
  id: BranchId;
  label: string;
  participantLine: string;
  alexLine: string;
}

export interface ScriptLine {
  key: 'CONTEXT' | 'OPEN' | 'M01';
  speaker: 'Context' | 'Alex';
  text: string;
}

export const SCENARIO_ID = `${raw.experience}/${raw.version}`;
export const ANCHOR_ID = raw.originalAnchorId; // "M01"
export const ORIGINAL_LINE: string = raw.immutableOriginal.line;
export const REFLECTION_QUESTION: string = raw.reflectionQuestion;

export const CONVERSATION: readonly ScriptLine[] = Object.freeze([
  {
    key: 'CONTEXT',
    speaker: 'Context',
    // From manual section 09, "CONTEXT" row.
    text: 'You are meeting Alex, a colleague, to discuss a fictional proposal.',
  },
  { key: 'OPEN', speaker: 'Alex', text: raw.startLine },
  { key: 'M01', speaker: 'Alex', text: ORIGINAL_LINE },
] as ScriptLine[]);

export const M01_INDEX = CONVERSATION.findIndex((l) => l.key === 'M01');

export const BRANCHES: Readonly<Record<BranchId, Branch>> = Object.freeze(
  Object.fromEntries(
    raw.hypotheticalBranches.map((b) => [b.id, Object.freeze({ ...b, id: b.id as BranchId })]),
  ) as Record<BranchId, Branch>,
);

/** Rough reading time so captions stay up long enough. ms */
export function lineDurationMs(text: string, fast = false): number {
  if (fast) return 250;
  return Math.max(2600, text.length * 62);
}
