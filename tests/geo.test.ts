import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_FEATURE_COLLECTION, calculateDistanceKm, createAccuracyCircle } from '../app/lib/geo.ts';

describe('calculateDistanceKm', () => {
  it('同一地点なら 0 になる', () => {
    assert.equal(calculateDistanceKm(35.681, 139.767, 35.681, 139.767), 0);
  });

  it('東京駅〜大阪駅は約 400km', () => {
    const km = calculateDistanceKm(35.681236, 139.767125, 34.702485, 135.495951);
    assert.ok(Math.abs(km - 403) < 5, `想定外の距離: ${km}`);
  });

  it('向きを入れ替えても同じ距離になる', () => {
    const forward = calculateDistanceKm(35.6, 139.7, 34.7, 135.5);
    const backward = calculateDistanceKm(34.7, 135.5, 35.6, 139.7);
    assert.ok(Math.abs(forward - backward) < 1e-9);
  });
});

describe('createAccuracyCircle', () => {
  const latitude = 35.681236;
  const longitude = 139.767125;

  it('閉じたポリゴンを 1 つだけ返す', () => {
    const circle = createAccuracyCircle(longitude, latitude, 10);
    assert.equal(circle.features.length, 1);

    const ring = circle.features[0].geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  });

  it('全頂点が中心からおよそ指定半径の位置にある', () => {
    const radiusMeters = 25;
    const ring = createAccuracyCircle(longitude, latitude, radiusMeters).features[0].geometry.coordinates[0];

    for (const [lon, lat] of ring) {
      const distanceMeters = calculateDistanceKm(latitude, longitude, lat, lon) * 1000;
      assert.ok(
        Math.abs(distanceMeters - radiusMeters) < radiusMeters * 0.02,
        `半径から外れた頂点: ${distanceMeters}m`,
      );
    }
  });

  it('高緯度でも円が潰れない（経度方向を cos で補正している）', () => {
    const highLatitude = 78;
    const ring = createAccuracyCircle(15, highLatitude, 50).features[0].geometry.coordinates[0];

    for (const [lon, lat] of ring) {
      const distanceMeters = calculateDistanceKm(highLatitude, 15, lat, lon) * 1000;
      assert.ok(Math.abs(distanceMeters - 50) < 2, `半径から外れた頂点: ${distanceMeters}m`);
    }
  });

  it('誤差円を消すための空コレクションは features を持たない', () => {
    assert.equal(EMPTY_FEATURE_COLLECTION.features.length, 0);
  });
});
