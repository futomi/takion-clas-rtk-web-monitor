import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_FEATURE_COLLECTION, calculateDistanceKm, createAccuracyCircle, toLocalOffsetMeters } from '../app/lib/geo.ts';

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

describe('toLocalOffsetMeters', () => {
  it('同じ地点なら 0', () => {
    assert.deepEqual(toLocalOffsetMeters(35, 139, 35, 139), { east: 0, north: 0 });
  });

  it('緯度 1 秒は北緯 35 度でおよそ 30.82 m の北', () => {
    const { east, north } = toLocalOffsetMeters(35, 139, 35 + 1 / 3600, 139);
    assert.ok(Math.abs(north - 30.82) < 0.02, `north=${north}`);
    assert.ok(Math.abs(east) < 1e-9);
  });

  it('経度 1 秒は北緯 35 度でおよそ 25.36 m の東', () => {
    const { east, north } = toLocalOffsetMeters(35, 139, 35, 139 + 1 / 3600);
    assert.ok(Math.abs(east - 25.36) < 0.02, `east=${east}`);
    assert.ok(Math.abs(north) < 1e-9);
  });

  it('南と西は負になる', () => {
    const { east, north } = toLocalOffsetMeters(35, 139, 34.9999, 138.9999);
    assert.ok(east < 0);
    assert.ok(north < 0);
  });
});
