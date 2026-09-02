import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GGA_QUALITY } from '../app/lib/constants.ts';
import {
  appendPlotSample,
  chooseOrigin,
  clampToBounds,
  formatGridLabel,
  formatPlaneLength,
  gridSpacingFor,
  originFromPoint,
  toPlanePosition,
  trailOpacity,
} from '../app/lib/localPlane.ts';
import type { TrackPoint } from '../app/lib/track.ts';

const BASE_LAT = 35.681236;
const BASE_LON = 139.767125;

function point(overrides: Partial<TrackPoint> & { at: number }): TrackPoint {
  return {
    latitude: BASE_LAT,
    longitude: BASE_LON,
    quality: GGA_QUALITY.PRECISE_FIX,
    ...overrides,
  };
}

describe('toPlanePosition', () => {
  const origin = originFromPoint(point({ at: 0, altitude: 40 }), false);

  it('原点そのものなら 0', () => {
    const position = toPlanePosition(origin, point({ at: 1000, altitude: 40 }));
    assert.equal(position.east, 0);
    assert.equal(position.north, 0);
    assert.equal(position.up, 0);
    assert.equal(position.distance, 0);
  });

  it('緯度 1e-6 度の北はおよそ 11.1 cm', () => {
    const position = toPlanePosition(origin, point({ at: 1000, latitude: BASE_LAT + 1e-6 }));
    assert.ok(position.north > 0.110 && position.north < 0.112, `north=${position.north}`);
    assert.ok(Math.abs(position.east) < 1e-9);
    assert.ok(Math.abs(position.distance - position.north) < 1e-12);
  });

  it('経度 1e-6 度の東は北緯 35.7 度でおよそ 9.0 cm', () => {
    const position = toPlanePosition(origin, point({ at: 1000, longitude: BASE_LON + 1e-6 }));
    assert.ok(position.east > 0.089 && position.east < 0.092, `east=${position.east}`);
    assert.ok(Math.abs(position.north) < 1e-9);
  });

  it('標高差は原点と点の両方に標高があるときだけ', () => {
    assert.equal(toPlanePosition(origin, point({ at: 1000, altitude: 40.3 })).up?.toFixed(3), '0.300');
    assert.equal(toPlanePosition(origin, point({ at: 1000 })).up, undefined);
    const originWithoutAltitude = originFromPoint(point({ at: 0 }), false);
    assert.equal(toPlanePosition(originWithoutAltitude, point({ at: 1000, altitude: 40 })).up, undefined);
  });
});

describe('chooseOrigin', () => {
  it('原点が無ければ最初の点を自動の原点にする', () => {
    const origin = chooseOrigin(null, point({ at: 0, quality: GGA_QUALITY.PRECISE_FLOAT }));
    assert.equal(origin?.latitude, BASE_LAT);
    assert.equal(origin?.isManual, false);
  });

  it('Float のうちに自動で置いた原点は、初めて Fix した点へ置き直す', () => {
    const floatOrigin = originFromPoint(point({ at: 0, quality: GGA_QUALITY.PRECISE_FLOAT }), false);
    const fixed = point({ at: 1000, latitude: BASE_LAT + 0.00001 });
    assert.equal(chooseOrigin(floatOrigin, fixed)?.latitude, fixed.latitude);
  });

  it('Fix で置いた原点は据え置く', () => {
    const fixOrigin = originFromPoint(point({ at: 0 }), false);
    assert.equal(chooseOrigin(fixOrigin, point({ at: 1000, quality: GGA_QUALITY.PRECISE_FLOAT })), null);
    assert.equal(chooseOrigin(fixOrigin, point({ at: 1000 })), null);
  });

  it('手で置いた原点は Fix しても動かさない', () => {
    const manual = originFromPoint(point({ at: 0, quality: GGA_QUALITY.STANDALONE }), true);
    assert.equal(chooseOrigin(manual, point({ at: 1000 })), null);
  });
});

describe('appendPlotSample', () => {
  it('別のエポックなら末尾へ積む', () => {
    const first = point({ at: 0, utc: '00:00:00' });
    const second = point({ at: 1000, utc: '00:00:01' });
    const samples = appendPlotSample(appendPlotSample([], first), second);
    assert.deepEqual(samples, [first, second]);
  });

  it('同じエポックの点は末尾を差し替える', () => {
    const first = point({ at: 0, utc: '00:00:00' });
    const refined = point({ at: 120, utc: '00:00:00', latitude: BASE_LAT + 1e-7 });
    const samples = appendPlotSample([first], refined);
    assert.equal(samples.length, 1);
    assert.equal(samples[0], refined);
  });

  it('同じエポックで見た目も同じなら配列をそのまま返す', () => {
    const first = point({ at: 0, utc: '00:00:00' });
    const samples = [first];
    assert.equal(appendPlotSample(samples, { ...first, at: 125 }), samples);
  });

  it('最新の点から尾の長さより古い点を落とす', () => {
    let samples: TrackPoint[] = [];
    for (const at of [0, 30_000, 70_000]) {
      samples = appendPlotSample(samples, point({ at, utc: `00:00:${at / 1000}` }), 60_000);
    }
    assert.deepEqual(samples.map((sample) => sample.at), [30_000, 70_000]);
  });

  it('上限を超えたら古いほうから捨てる', () => {
    let samples: TrackPoint[] = [];
    for (let index = 0; index < 5; index += 1) {
      samples = appendPlotSample(samples, point({ at: index * 1000, utc: `00:00:0${index}` }), 60_000, 3);
    }
    assert.deepEqual(samples.map((sample) => sample.at), [2000, 3000, 4000]);
  });
});

describe('trailOpacity', () => {
  it('最新は 1、尾の終わりで 0.15、それより古くても 0.15 のまま', () => {
    assert.equal(trailOpacity(0, 60_000), 1);
    assert.ok(Math.abs(trailOpacity(60_000, 60_000) - 0.15) < 1e-12);
    assert.ok(Math.abs(trailOpacity(90_000, 60_000) - 0.15) < 1e-12);
  });
});

describe('gridSpacingFor', () => {
  it('狭いほど細かい格子にする', () => {
    assert.deepEqual(gridSpacingFor(1), { minor: 0.1, major: 0.5 });
    assert.deepEqual(gridSpacingFor(2), { minor: 0.1, major: 1 });
    assert.deepEqual(gridSpacingFor(5), { minor: 0.5, major: 1 });
  });
});

describe('formatGridLabel', () => {
  it('整数は小数を出さず、端数は 1 桁', () => {
    assert.equal(formatGridLabel(1), '1 m');
    assert.equal(formatGridLabel(-2), '-2 m');
    assert.equal(formatGridLabel(0.5), '0.5 m');
  });
});

describe('formatPlaneLength', () => {
  it('1 m 未満は cm、以上は m', () => {
    assert.equal(formatPlaneLength(0.324), '32.4 cm');
    assert.equal(formatPlaneLength(1.234), '1.23 m');
    assert.equal(formatPlaneLength(0.9996), '1.00 m');
  });

  it('符号付きでは向きを付け、0 に丸まる値には付けない', () => {
    assert.equal(formatPlaneLength(-0.05, { signed: true }), '-5.0 cm');
    assert.equal(formatPlaneLength(0.05, { signed: true }), '+5.0 cm');
    assert.equal(formatPlaneLength(0.0002, { signed: true }), '0.0 cm');
    assert.equal(formatPlaneLength(-0.0002, { signed: true }), '0.0 cm');
  });
});

describe('clampToBounds', () => {
  it('範囲内はそのまま', () => {
    assert.deepEqual(clampToBounds(0.5, -0.5, 2, 1), { east: 0.5, north: -0.5, isOutside: false });
  });

  it('範囲外は向きを保って縁まで縮める', () => {
    const clamped = clampToBounds(4, 2, 2, 2);
    assert.equal(clamped.isOutside, true);
    assert.equal(clamped.east, 2);
    assert.equal(clamped.north, 1);
  });

  it('南北だけはみ出しても縮める', () => {
    const clamped = clampToBounds(0.5, -3, 2, 1);
    assert.equal(clamped.isOutside, true);
    assert.ok(Math.abs(clamped.north + 1) < 1e-12);
    assert.ok(Math.abs(clamped.east - 0.5 / 3) < 1e-12);
  });
});
