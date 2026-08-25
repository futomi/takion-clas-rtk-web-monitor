import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearPositionFields, hasPosition, type Telemetry } from '../app/lib/telemetry.ts';

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
