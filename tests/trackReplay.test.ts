import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPLAY_MAX_STEP_MS, REPLAY_MIN_STEP_MS } from '../app/lib/constants.ts';
import type { TrackPoint } from '../app/lib/track.ts';
import { replayProgress, replayStepDelayMs } from '../app/lib/trackReplay.ts';

function point(at: number): TrackPoint {
  return { at, latitude: 35.6, longitude: 139.7 };
}

describe('replayStepDelayMs', () => {
  const points = [point(0), point(1000), point(1200), point(60_000), point(59_000)];

  it('記録どおりの間隔で次の点まで待つ', () => {
    assert.equal(replayStepDelayMs(points, 0), 1000);
    assert.equal(replayStepDelayMs(points, 1), 200);
  });

  it('欠測の区間は上限で詰める', () => {
    assert.equal(replayStepDelayMs(points, 2), REPLAY_MAX_STEP_MS);
  });

  it('時刻が巻き戻っていても下限だけは待つ', () => {
    assert.equal(replayStepDelayMs(points, 3), REPLAY_MIN_STEP_MS);
  });

  it('最後の点と範囲外では null', () => {
    assert.equal(replayStepDelayMs(points, 4), null);
    assert.equal(replayStepDelayMs(points, -1), null);
    assert.equal(replayStepDelayMs([], 0), null);
  });
});

describe('replayProgress', () => {
  const points = [point(5000), point(6000), point(9000)];

  it('先頭からの経過と全体の長さを記録上の時刻で測る', () => {
    assert.deepEqual(replayProgress(points, 0), { elapsedMs: 0, totalMs: 4000 });
    assert.deepEqual(replayProgress(points, 1), { elapsedMs: 1000, totalMs: 4000 });
    assert.deepEqual(replayProgress(points, 2), { elapsedMs: 4000, totalMs: 4000 });
  });

  it('範囲外の位置は両端に丸める', () => {
    assert.equal(replayProgress(points, 99).elapsedMs, 4000);
    assert.equal(replayProgress(points, -5).elapsedMs, 0);
    assert.deepEqual(replayProgress([], 0), { elapsedMs: 0, totalMs: 0 });
  });
});
