import type { FeatureCollection, Polygon } from 'geojson';

/** 地球の半径（km）。Haversine 式で使用する球体近似値 */
const EARTH_RADIUS_KM = 6371;

/** 緯度 1 度あたりの距離（m）。極付近まで含めた平均値 */
const METERS_PER_LATITUDE_DEGREE = 110_574;
/** 赤道上での経度 1 度あたりの距離（m）。緯度に応じて cos で縮める */
const METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR = 111_320;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** 2 地点間の大円距離を km で返す（Haversine 式） */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 円周を近似する頂点数。地図上の誤差円としてはこの程度で十分滑らかに見える */
const CIRCLE_POINT_COUNT = 64;

/**
 * 指定地点を中心とする半径 `radiusMeters` の円を GeoJSON ポリゴンで返す。
 * 推定水平誤差の可視化に使う。
 *
 * 描画は地図ライブラリの仕事だが、円周の座標計算自体は地図に依存しない純粋な幾何なので
 * ここへ置いてテスト可能にしている。
 */
export function createAccuracyCircle(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): FeatureCollection<Polygon> {
  // 高緯度では経度方向が詰まる。極付近で 0 除算にならないよう下限を張る
  const metersPerLongitudeDegree = Math.max(
    1,
    METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR * Math.cos(toRadians(latitude)),
  );
  const coordinates: [number, number][] = [];

  for (let index = 0; index <= CIRCLE_POINT_COUNT; index += 1) {
    const angle = (index / CIRCLE_POINT_COUNT) * Math.PI * 2;
    coordinates.push([
      longitude + (Math.cos(angle) * radiusMeters) / metersPerLongitudeDegree,
      latitude + (Math.sin(angle) * radiusMeters) / METERS_PER_LATITUDE_DEGREE,
    ]);
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    }],
  };
}

/** 座標を持たない、空の GeoJSON。誤差円を消すときに使う */
export const EMPTY_FEATURE_COLLECTION: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [],
};
