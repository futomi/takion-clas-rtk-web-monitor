import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SatelliteTracker } from '../app/lib/satelliteTracker.ts';
import { identifyGnssSystem } from '../app/lib/gnssSystem.ts';

describe('identifyGnssSystem', () => {
  it('System ID を最優先で使う', () => {
    assert.equal(identifyGnssSystem(1, 'GN', 5), 'qzss');
    assert.equal(identifyGnssSystem(1, 'GP', 2), 'glonass');
  });
  it('System ID が無ければ talker を使う', () => {
    assert.equal(identifyGnssSystem(1, 'GA'), 'galileo');
    assert.equal(identifyGnssSystem(1, 'GB'), 'beidou');
  });
  it('talker が GN なら PRN の番号帯から推定する', () => {
    assert.equal(identifyGnssSystem(5, 'GN'), 'gps');
    assert.equal(identifyGnssSystem(194, 'GN'), 'qzss');
    assert.equal(identifyGnssSystem(70, 'GN'), 'glonass');
    assert.equal(identifyGnssSystem(310, 'GN'), 'galileo');
    assert.equal(identifyGnssSystem(410, 'GN'), 'beidou');
    assert.equal(identifyGnssSystem(130, 'GN'), 'sbas');
    assert.equal(identifyGnssSystem(999, 'GN'), 'other');
  });
});

describe('SatelliteTracker 可視衛星', () => {
  it('PRN が取れる場合はシステム別に重複なく数える', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsv({ talker: 'GP', prns: [1, 2, 3], totalInView: 3 }, 1000);
    tracker.applyGsv({ talker: 'GQ', prns: [194, 195], totalInView: 2 }, 1000);
    // 同じ PRN が再送されても二重計上しない
    tracker.applyGsv({ talker: 'GP', prns: [1, 2], totalInView: 3 }, 1200);

    const summary = tracker.inViewSummary(1200);
    assert.equal(summary.total, 5);
    assert.deepEqual(summary.breakdown, { gps: 3, qzss: 2 });
  });

  it('PRN が無い場合は talker ごとの申告値へフォールバックする', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsv({ talker: 'GP', prns: [], totalInView: 8 }, 1000);
    tracker.applyGsv({ talker: 'GL', prns: [], totalInView: 6 }, 1000);

    const summary = tracker.inViewSummary(1000);
    assert.equal(summary.total, 14);
    assert.deepEqual(summary.breakdown, { gps: 8, glonass: 6 });
  });

  it('8 秒以上更新の無い PRN を失効させる', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsv({ talker: 'GP', prns: [1, 2], totalInView: 2 }, 1000);
    tracker.applyGsv({ talker: 'GP', prns: [3], totalInView: 3 }, 8500);

    // 1000ms 時点の PRN は 9001ms には期限切れ（TTL 8000ms）
    const summary = tracker.inViewSummary(9001);
    assert.equal(summary.total, 1);
    assert.deepEqual(summary.breakdown, { gps: 1 });
  });

  it('可視衛星が一つも無ければ総数 0 を返す', () => {
    const tracker = new SatelliteTracker();
    assert.deepEqual(tracker.inViewSummary(0), { total: 0, breakdown: {} });
  });
});

describe('SatelliteTracker 使用衛星', () => {
  it('系統ごとの GSA を合算し、同一衛星の重複を排除する', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsa({ talker: 'GN', systemId: 1, prns: [1, 2, 3] }, 1000);
    tracker.applyGsa({ talker: 'GN', systemId: 5, prns: [194, 195] }, 1000);

    const summary = tracker.usedSummary(1000);
    assert.equal(summary.total, 5);
    assert.deepEqual(summary.breakdown, { gps: 3, qzss: 2 });
  });

  it('同じ系統の GSA が再送されたら置き換える', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsa({ talker: 'GN', systemId: 1, prns: [1, 2, 3, 4] }, 1000);
    tracker.applyGsa({ talker: 'GN', systemId: 1, prns: [1, 2] }, 1500);

    assert.equal(tracker.usedSummary(1500).total, 2);
  });

  it('5 秒以上更新の無い系統を失効させる', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsa({ talker: 'GN', systemId: 1, prns: [1, 2, 3] }, 1000);
    tracker.applyGsa({ talker: 'GN', systemId: 5, prns: [194] }, 5500);

    const summary = tracker.usedSummary(6001);
    assert.equal(summary.total, 1);
    assert.deepEqual(summary.breakdown, { qzss: 1 });
  });

  it('reset で全状態を破棄する', () => {
    const tracker = new SatelliteTracker();
    tracker.applyGsv({ talker: 'GP', prns: [1], totalInView: 1 }, 1000);
    tracker.applyGsa({ talker: 'GN', systemId: 1, prns: [1] }, 1000);
    tracker.reset();
    assert.equal(tracker.inViewSummary(1000).total, 0);
    assert.equal(tracker.usedSummary(1000).total, 0);
  });
});
