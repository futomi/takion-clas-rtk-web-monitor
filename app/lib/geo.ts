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

/** WGS84 楕円体の長半径（m）と第一離心率の 2 乗。局所平面への換算で使う */
const WGS84_SEMI_MAJOR_AXIS_M = 6_378_137;
const WGS84_ECCENTRICITY_SQUARED = 0.006_694_379_990_14;

/** 局所平面上の変位（m）。東と北が正 */
export type LocalOffset = { east: number; north: number };

/**
 * 原点から見た地点の変位を、東西・南北のメートルで返す。
 *
 * 原点まわりで地球を平面とみなし、原点の緯度における子午線曲率半径と卯酉線曲率半径で
 * 度をメートルへ換算する。数十 m の範囲なら mm 未満の誤差に収まるので、
 * 地図タイルでは見えない cm 単位の動きを白紙の平面に描く用途に足りる。
 * 誤差円（{@link createAccuracyCircle}）より厳密にしているのは、こちらは巻尺と見比べられるため。
 */
export function toLocalOffsetMeters(
  originLatitude: number,
  originLongitude: number,
  latitude: number,
  longitude: number,
): LocalOffset {
  const phi = toRadians(originLatitude);
  const sinPhi = Math.sin(phi);
  const denominator = Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinPhi * sinPhi);
  const meridionalRadius = (WGS84_SEMI_MAJOR_AXIS_M * (1 - WGS84_ECCENTRICITY_SQUARED)) / denominator ** 3;
  const primeVerticalRadius = WGS84_SEMI_MAJOR_AXIS_M / denominator;
  return {
    east: toRadians(longitude - originLongitude) * primeVerticalRadius * Math.cos(phi),
    north: toRadians(latitude - originLatitude) * meridionalRadius,
  };
}
