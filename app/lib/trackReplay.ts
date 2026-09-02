import { REPLAY_MAX_STEP_MS, REPLAY_MIN_STEP_MS } from './constants';
import type { TrackPoint } from './track';

/**
 * 再生中、index の点を出してから次の点を出すまでに待つ時間（ms）。最後の点なら null。
 *
 * 記録どおりの間隔で進めるが、欠測で空いた区間はそのまま待たせず上限で詰める。
 * 時刻が巻き戻っている記録でも止まらないよう下限も張る。
 */
export function replayStepDelayMs(points: TrackPoint[], index: number): number | null {
  if (index < 0 || index >= points.length - 1) return null;
  const gap = points[index + 1].at - points[index].at;
  return Math.min(REPLAY_MAX_STEP_MS, Math.max(REPLAY_MIN_STEP_MS, gap));
}

/** 再生位置までの経過時間と全体の長さ（ms）。どちらも記録上の時刻で測る */
export function replayProgress(points: TrackPoint[], index: number): { elapsedMs: number; totalMs: number } {
  if (points.length === 0) return { elapsedMs: 0, totalMs: 0 };
  const start = points[0].at;
  const clamped = Math.min(Math.max(index, 0), points.length - 1);
  return {
    elapsedMs: Math.max(0, points[clamped].at - start),
    totalMs: Math.max(0, points[points.length - 1].at - start),
  };
}
