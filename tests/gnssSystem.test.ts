import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GNSS_SYSTEMS,
  GNSS_SYSTEM_ORDER,
  getGnssSystemFromTalker,
  identifyGnssSystem,
} from '../app/lib/gnssSystem.ts';

describe('getGnssSystemFromTalker', () => {
  it('talker ID を衛星システムへ対応付ける', () => {
    assert.equal(getGnssSystemFromTalker('GP'), 'gps');
    assert.equal(getGnssSystemFromTalker('GQ'), 'qzss');
    assert.equal(getGnssSystemFromTalker('QZ'), 'qzss');
    assert.equal(getGnssSystemFromTalker('GA'), 'galileo');
    assert.equal(getGnssSystemFromTalker('GL'), 'glonass');
    assert.equal(getGnssSystemFromTalker('GB'), 'beidou');
    assert.equal(getGnssSystemFromTalker('BD'), 'beidou');
    assert.equal(getGnssSystemFromTalker('SB'), 'sbas');
  });

  it('大文字小文字を問わない', () => {
    assert.equal(getGnssSystemFromTalker('gq'), 'qzss');
  });

  it('未知の talker は other になる', () => {
    assert.equal(getGnssSystemFromTalker('XX'), 'other');
    // 複合測位を表す GN は系統を特定できないため other 扱い
    assert.equal(getGnssSystemFromTalker('GN'), 'other');
  });
});

describe('identifyGnssSystem', () => {
  it('System ID があれば最優先で採用する', () => {
    // PRN も talker も GPS を指すが、System ID の 5 (QZSS) が勝つ
    assert.equal(identifyGnssSystem(1, 'GP', 5), 'qzss');
    assert.equal(identifyGnssSystem(1, 'GP', 2), 'glonass');
    assert.equal(identifyGnssSystem(1, 'GP', 3), 'galileo');
    assert.equal(identifyGnssSystem(1, 'GP', 4), 'beidou');
  });

  it('System ID が文字列でも解釈する', () => {
    assert.equal(identifyGnssSystem(1, 'GP', '5'), 'qzss');
  });

  it('範囲外・未指定の System ID は無視して次の手掛かりへ進む', () => {
    assert.equal(identifyGnssSystem(1, 'GL', 9), 'glonass');
    assert.equal(identifyGnssSystem(1, 'GL'), 'glonass');
  });

  it('GN 以外の talker があれば PRN 帯より talker を優先する', () => {
    // PRN 1 は GPS 帯だが、talker が Galileo を名乗っている
    assert.equal(identifyGnssSystem(1, 'GA'), 'galileo');
  });

  it('talker が GN のときは PRN 番号帯で判定する', () => {
    assert.equal(identifyGnssSystem(1, 'GN'), 'gps');
    assert.equal(identifyGnssSystem(32, 'GN'), 'gps');
    assert.equal(identifyGnssSystem(65, 'GN'), 'glonass');
    assert.equal(identifyGnssSystem(96, 'GN'), 'glonass');
    assert.equal(identifyGnssSystem(193, 'GN'), 'qzss');
    assert.equal(identifyGnssSystem(202, 'GN'), 'qzss');
    assert.equal(identifyGnssSystem(301, 'GN'), 'galileo');
    assert.equal(identifyGnssSystem(336, 'GN'), 'galileo');
    assert.equal(identifyGnssSystem(401, 'GN'), 'beidou');
    assert.equal(identifyGnssSystem(463, 'GN'), 'beidou');
    assert.equal(identifyGnssSystem(33, 'GN'), 'sbas');
    assert.equal(identifyGnssSystem(64, 'GN'), 'sbas');
    assert.equal(identifyGnssSystem(120, 'GN'), 'sbas');
    assert.equal(identifyGnssSystem(158, 'GN'), 'sbas');
  });

  it('どの番号帯にも入らない PRN は other になる', () => {
    assert.equal(identifyGnssSystem(0, 'GN'), 'other');
    assert.equal(identifyGnssSystem(119, 'GN'), 'other');
    assert.equal(identifyGnssSystem(999, 'GN'), 'other');
  });
});

describe('GNSS_SYSTEMS / GNSS_SYSTEM_ORDER', () => {
  it('表示順に列挙されたキーがすべて辞書に存在する', () => {
    for (const key of GNSS_SYSTEM_ORDER) {
      assert.equal(GNSS_SYSTEMS[key].key, key);
    }
    assert.equal(GNSS_SYSTEM_ORDER.length, Object.keys(GNSS_SYSTEMS).length);
  });
});
