import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearPositionFields,
  dropNmeaPositionCoveredByUbx,
  hasPosition,
  positionEpoch,
  type Telemetry,
} from '../app/lib/telemetry.ts';

describe('hasPosition', () => {
  it('緯度と経度が両方そろって初めて測位済みとみなす', () => {
    assert.equal(hasPosition({}), false);
    assert.equal(hasPosition({ latitude: 35.6 }), false);
    assert.equal(hasPosition({ longitude: 139.7 }), false);
    assert.equal(hasPosition({ latitude: 35.6, longitude: 139.7 }), true);
  });

  it('0 度を未取得と取り違えない', () => {
    assert.equal(hasPosition({ latitude: 0, longitude: 0 }), true);
  });
});

describe('clearPositionFields', () => {
  it('測位解に由来する項目を undefined で明示的に埋める', () => {
    const update: Partial<Telemetry> = {};
    clearPositionFields(update);

    // キー自体は残す必要がある。Telemetry へは差分をマージするため、
    // キーが無いと直前の値が残ってしまう
    for (const key of [
      'latitude', 'longitude', 'altitude', 'geoidSeparation', 'horizontalError', 'verticalError',
    ] as const) {
      assert.ok(key in update, `${key} のキーが無い`);
      assert.equal(update[key], undefined);
    }
  });

  it('電文ごとに載る項目（DOP・速度・方位）は触らない', () => {
    const update: Partial<Telemetry> = { hdop: 1.2, pdop: 2.0, speedKmh: 10, course: 90 };
    clearPositionFields(update);

    assert.equal(update.hdop, 1.2);
    assert.equal(update.pdop, 2.0);
    assert.equal(update.speedKmh, 10);
    assert.equal(update.course, 90);
  });
});

describe('positionEpoch', () => {
  it('小数秒を落として秒までに揃える', () => {
    assert.equal(positionEpoch('12:34:56.00'), '12:34:56');
    assert.equal(positionEpoch('12:34:56'), '12:34:56');
  });

  it('時刻が無い、または短すぎれば undefined', () => {
    assert.equal(positionEpoch(undefined), undefined);
    assert.equal(positionEpoch('12:34'), undefined);
  });
});

describe('dropNmeaPositionCoveredByUbx', () => {
  const ggaUpdate: Partial<Telemetry> = {
    timeUtc: '12:34:56.00',
    quality: 4,
    satellitesUsed: 20,
    latitude: 35.68124,
    longitude: 139.76713,
    altitude: 40.1,
    geoidSeparation: 36.5,
    hdop: 0.7,
  };

  it('UBX が同じエポックを持っていれば座標だけを外す', () => {
    const result = dropNmeaPositionCoveredByUbx(ggaUpdate, '12:34:56');
    assert.equal('latitude' in result, false);
    assert.equal('longitude' in result, false);
    assert.equal('altitude' in result, false);
    assert.equal('geoidSeparation' in result, false);
    assert.equal(result.quality, 4);
    assert.equal(result.satellitesUsed, 20);
    assert.equal(result.hdop, 0.7);
    assert.equal(result.timeUtc, '12:34:56.00');
  });

  it('別のエポックなら触らない', () => {
    assert.equal(dropNmeaPositionCoveredByUbx(ggaUpdate, '12:34:55'), ggaUpdate);
  });

  it('UBX 側のエポックが無ければ触らない', () => {
    assert.equal(dropNmeaPositionCoveredByUbx(ggaUpdate, undefined), ggaUpdate);
  });

  it('未測位による undefined での上書きは通す', () => {
    const cleared: Partial<Telemetry> = { timeUtc: '12:34:56.00', quality: 0 };
    clearPositionFields(cleared);
    const result = dropNmeaPositionCoveredByUbx(cleared, '12:34:56');
    assert.equal(result, cleared);
    assert.ok('latitude' in result);
  });
});
