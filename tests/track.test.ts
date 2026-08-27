import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GGA_QUALITY } from '../app/lib/constants.ts';
import {
  buildTrackFeatures,
  buildTrackStartFeature,
  createTrackFeatureBuilder,
  formatUtcTimestamp,
  normalizeStoredPoint,
  shouldRecordPoint,
  splitTrackByGap,
  summarizeTrack,
  toTrackPoint,
  trackPointTone,
  type TrackPoint,
} from '../app/lib/track.ts';

const BASE_LAT = 35.681236;
const BASE_LON = 139.767125;

/** 緯度 0.0001 度はおよそ 11m。閾値を跨ぐ移動として使う */
const STEP_DEGREES = 0.0001;

function point(overrides: Partial<TrackPoint> & { at: number }): TrackPoint {
  return {
    latitude: BASE_LAT,
    longitude: BASE_LON,
    quality: GGA_QUALITY.PRECISE_FIX,
    ...overrides,
  };
}

describe('formatUtcTimestamp', () => {
  it('日付と時刻が揃えば ISO 8601 にまとめる', () => {
    assert.equal(formatUtcTimestamp('2026-08-27', '12:34:56'), '2026-08-27T12:34:56Z');
  });

  it('日付が無ければ時刻だけを返す', () => {
    assert.equal(formatUtcTimestamp(undefined, '12:34:56'), '12:34:56');
  });

  it('時刻が無ければ undefined', () => {
    assert.equal(formatUtcTimestamp('2026-08-27', undefined), undefined);
  });
});

describe('toTrackPoint', () => {
  it('測位解が無ければ null', () => {
    assert.equal(toTrackPoint({ quality: GGA_QUALITY.NO_FIX }, 1000), null);
    assert.equal(toTrackPoint({ latitude: BASE_LAT }, 1000), null);
  });

  it('測位情報をそのまま写し取る', () => {
    const created = toTrackPoint({
      latitude: BASE_LAT,
      longitude: BASE_LON,
      altitude: 12.3,
      quality: GGA_QUALITY.PRECISE_FIX,
      hdop: 0.7,
      satellitesUsed: 21,
      dateUtc: '2026-08-27',
      timeUtc: '01:02:03',
    }, 5000);

    assert.equal(created?.at, 5000);
    assert.equal(created?.utc, '2026-08-27T01:02:03Z');
    assert.equal(created?.altitude, 12.3);
    assert.equal(created?.satellitesUsed, 21);
  });
});

describe('shouldRecordPoint', () => {
  it('最初の点は必ず記録する', () => {
    assert.equal(shouldRecordPoint(undefined, point({ at: 0 }), 1000), true);
  });

  it('受信機の申告する UTC が同じなら同一エポックの重複として捨てる', () => {
    const previous = point({ at: 0, utc: '2026-08-27T00:00:01Z' });
    const candidate = point({ at: 3000, utc: '2026-08-27T00:00:01Z' });
    assert.equal(shouldRecordPoint(previous, candidate, 1000), false);
  });

  it('間隔に満たなければ捨てる', () => {
    assert.equal(shouldRecordPoint(point({ at: 0 }), point({ at: 999 }), 1000), false);
    assert.equal(shouldRecordPoint(point({ at: 0 }), point({ at: 1000 }), 1000), true);
  });

  it('時計が巻き戻っても記録を止めない', () => {
    assert.equal(shouldRecordPoint(point({ at: 10_000 }), point({ at: 5000 }), 1000), true);
  });
});

describe('summarizeTrack', () => {
  it('空配列は 0 件', () => {
    assert.deepEqual(summarizeTrack([]), { count: 0, distanceMeters: 0, durationMs: 0 });
  });

  it('静止中の揺らぎは距離に足さない', () => {
    const points = [0, 1, 2].map((index) => point({
      at: index * 1000,
      // 0.000001 度はおよそ 0.11m。閾値 0.3m を下回る
      latitude: BASE_LAT + index * 0.000001,
    }));
    assert.equal(summarizeTrack(points).distanceMeters, 0);
  });

  it('移動した距離と経過時間を集計する', () => {
    const points = [0, 1, 2].map((index) => point({
      at: index * 1000,
      latitude: BASE_LAT + index * STEP_DEGREES,
    }));
    const summary = summarizeTrack(points);

    assert.equal(summary.count, 3);
    assert.equal(summary.durationMs, 2000);
    assert.ok(Math.abs(summary.distanceMeters - 22.2) < 0.5, `想定外の距離: ${summary.distanceMeters}`);
  });
});

describe('splitTrackByGap', () => {
  it('欠測を跨いだところで分ける', () => {
    const points = [
      point({ at: 0 }),
      point({ at: 1000 }),
      point({ at: 60_000 }),
    ];
    const groups = splitTrackByGap(points, 30_000);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].length, 2);
    assert.equal(groups[1].length, 1);
  });

  it('空配列なら連なりも空', () => {
    assert.deepEqual(splitTrackByGap([], 30_000), []);
  });
});

describe('trackPointTone', () => {
  it('測位品質を地図の色調へ対応させる', () => {
    assert.equal(trackPointTone(point({ at: 0, quality: GGA_QUALITY.PRECISE_FIX })), 'fix');
    assert.equal(trackPointTone(point({ at: 0, quality: GGA_QUALITY.PRECISE_FLOAT })), 'float');
    assert.equal(trackPointTone(point({ at: 0, quality: GGA_QUALITY.STANDALONE })), 'single');
  });
});

describe('buildTrackFeatures', () => {
  it('点が 1 つだけならラインを作らない', () => {
    assert.equal(buildTrackFeatures([point({ at: 0 })]).features.length, 0);
    assert.equal(buildTrackFeatures([]).features.length, 0);
  });

  it('同じ品質が続く間は 1 本にまとめる', () => {
    const points = [0, 1, 2].map((index) => point({ at: index * 1000 }));
    const collection = buildTrackFeatures(points, 30_000);

    assert.equal(collection.features.length, 1);
    assert.equal(collection.features[0].properties.tone, 'fix');
    assert.equal(collection.features[0].geometry.coordinates.length, 3);
  });

  it('欠測ではラインを切り、繋がったままにしない', () => {
    const points = [
      point({ at: 0 }),
      point({ at: 1000 }),
      point({ at: 60_000 }),
      point({ at: 61_000 }),
    ];
    const collection = buildTrackFeatures(points, 30_000);

    assert.equal(collection.features.length, 2);
    assert.equal(collection.features[0].geometry.coordinates.length, 2);
    assert.equal(collection.features[1].geometry.coordinates.length, 2);
  });

  it('品質が変わる位置で色を分けつつ、線は途切れさせない', () => {
    const points = [
      point({ at: 0, quality: GGA_QUALITY.PRECISE_FIX }),
      point({ at: 1000, quality: GGA_QUALITY.PRECISE_FIX }),
      point({ at: 2000, quality: GGA_QUALITY.STANDALONE }),
      point({ at: 3000, quality: GGA_QUALITY.STANDALONE }),
    ];
    const collection = buildTrackFeatures(points, 30_000);

    assert.equal(collection.features.length, 2);
    assert.equal(collection.features[0].properties.tone, 'fix');
    assert.equal(collection.features[1].properties.tone, 'single');
    // 区間の品質は色調と食い違ってはいけない。境目の点は次の区間のものとして数える
    assert.equal(collection.features[0].properties.quality, GGA_QUALITY.PRECISE_FIX);
    assert.equal(collection.features[1].properties.quality, GGA_QUALITY.STANDALONE);
    // 切り替え点は両方のラインに含まれるので、見た目に隙間ができない
    assert.equal(collection.features[0].geometry.coordinates.length, 3);
    assert.equal(collection.features[1].geometry.coordinates.length, 2);
  });
});

describe('createTrackFeatureBuilder', () => {
  /**
   * 増分で組み立てた結果が、毎回すべての点から組み直した結果と食い違わないことを確かめる。
   * 確定した区間を作り直さない最適化なので、一致こそがこの関数の唯一の約束になる。
   */
  const assertMatchesFullBuild = (points: TrackPoint[], gapMs: number) => {
    const build = createTrackFeatureBuilder(gapMs);
    for (let count = 0; count <= points.length; count += 1) {
      const prefix = points.slice(0, count);
      assert.deepEqual(
        build(prefix),
        buildTrackFeatures(prefix, gapMs),
        `${count} 点まで積んだ時点で全体組み直しと一致しない`,
      );
    }
  };

  it('品質が変わり続ける軌跡でも全体組み直しと一致する', () => {
    const qualities = [
      GGA_QUALITY.PRECISE_FIX,
      GGA_QUALITY.PRECISE_FIX,
      GGA_QUALITY.PRECISE_FLOAT,
      GGA_QUALITY.STANDALONE,
      GGA_QUALITY.STANDALONE,
      GGA_QUALITY.PRECISE_FIX,
    ];
    assertMatchesFullBuild(
      qualities.map((quality, index) => point({ at: index * 1000, quality })),
      30_000,
    );
  });

  it('欠測を跨いでも全体組み直しと一致する', () => {
    const times = [0, 1000, 2000, 90_000, 91_000, 92_000, 200_000];
    assertMatchesFullBuild(times.map((at) => point({ at })), 30_000);
  });

  it('記録を消して別の軌跡を始めても前の区間を引きずらない', () => {
    const build = createTrackFeatureBuilder(30_000);
    const first = [0, 1000, 2000].map((at) => point({ at }));
    build(first);

    // 記録の消去は空配列を経由する。ここで控えが捨てられないと前の線が残る
    assert.equal(build([]).features.length, 0);

    const second = [0, 1000].map((at) => point({ at, longitude: BASE_LON + STEP_DEGREES }));
    assert.deepEqual(build(second), buildTrackFeatures(second, 30_000));
  });

  it('先頭が入れ替わった配列を渡されたら組み直す', () => {
    const build = createTrackFeatureBuilder(30_000);
    const first = [0, 1000, 2000, 3000].map((at) => point({ at }));
    build(first);

    // 同じ長さでも別の軌跡なら、確定済みの区間を使い回してはいけない
    const replaced = [0, 1000, 2000, 3000].map((at) => point({ at, latitude: BASE_LAT + STEP_DEGREES }));
    assert.deepEqual(build(replaced), buildTrackFeatures(replaced, 30_000));
  });

  it('一時的に非表示にしても、再び表示したときに同じ結果へ戻る', () => {
    const points = [0, 1000, 2000, 60_000, 61_000].map((at) => point({ at }));
    const build = createTrackFeatureBuilder(30_000);
    build(points);
    build([]);
    assert.deepEqual(build(points), buildTrackFeatures(points, 30_000));
  });
});

describe('buildTrackStartFeature', () => {
  it('始点を 1 つだけ返す', () => {
    const collection = buildTrackStartFeature([
      point({ at: 0, longitude: BASE_LON }),
      point({ at: 1000, longitude: BASE_LON + STEP_DEGREES }),
    ]);

    assert.equal(collection.features.length, 1);
    assert.deepEqual(collection.features[0].geometry.coordinates, [BASE_LON, BASE_LAT]);
  });

  it('点が無ければ空', () => {
    assert.equal(buildTrackStartFeature([]).features.length, 0);
  });
});

describe('normalizeStoredPoint', () => {
  it('座標か時刻を欠くレコードは復元しない', () => {
    assert.equal(normalizeStoredPoint(null), null);
    assert.equal(normalizeStoredPoint({ latitude: BASE_LAT, longitude: BASE_LON }), null);
    assert.equal(normalizeStoredPoint({ at: 1, longitude: BASE_LON }), null);
  });

  it('範囲外の座標も復元しない', () => {
    assert.equal(normalizeStoredPoint({ at: 1, latitude: 91, longitude: 0 }), null);
    assert.equal(normalizeStoredPoint({ at: 1, latitude: 0, longitude: 181 }), null);
  });

  it('壊れた値の項目だけを捨てて読み戻す', () => {
    const restored = normalizeStoredPoint({
      at: 1000,
      latitude: BASE_LAT,
      longitude: BASE_LON,
      altitude: 'high',
      hdop: Number.NaN,
      quality: GGA_QUALITY.PRECISE_FIX,
      utc: '2026-08-27T00:00:00Z',
    });

    assert.equal(restored?.altitude, undefined);
    assert.equal(restored?.hdop, undefined);
    assert.equal(restored?.quality, GGA_QUALITY.PRECISE_FIX);
    assert.equal(restored?.utc, '2026-08-27T00:00:00Z');
  });
});
