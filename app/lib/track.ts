import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { TRACK_DISTANCE_EPSILON_M, TRACK_GAP_MS } from './constants';
import { resolveQualityDisplay, type QualityTone } from './correctionSource';
import { calculateDistanceKm } from './geo';
import { hasPosition, type Telemetry } from './telemetry';

/**
 * 記録した軌跡の 1 点。
 *
 * 位置と時刻だけでなく測位品質も持たせている。これがあると
 * 「どこで Fix が外れたか」を地図の色分けでも書き出したログでも追える。
 */
export type TrackPoint = {
  /** PC 側の受信時刻（epoch ms）。並べ替えと経過時間はすべてこれを基準にする */
  at: number;
  /**
   * 受信機が申告した UTC。
   * 日付と時刻が揃っていれば YYYY-MM-DDTHH:MM:SSZ、時刻しか無ければ HH:MM:SS。
   * 同一エポックの重複を弾く鍵も兼ねる。
   */
  utc?: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  /** 測位品質。GGA_QUALITY のいずれか */
  quality?: number;
  satellitesUsed?: number;
  hdop?: number;
  horizontalError?: number;
  verticalError?: number;
  speedKmh?: number;
  course?: number;
};

/** 軌跡全体の集計値 */
export type TrackSummary = {
  count: number;
  /** 連続する点の間隔を足し上げた移動距離（m） */
  distanceMeters: number;
  /** 最初の点から最後の点までの経過時間（ms） */
  durationMs: number;
  startedAt?: number;
  endedAt?: number;
};

/**
 * 受信機の申告した日付と時刻を 1 つの文字列にまとめる。
 * 日付が無い電文（GGA など）しか来ていない間は時刻だけを返す。
 */
export function formatUtcTimestamp(dateUtc?: string, timeUtc?: string): string | undefined {
  if (!timeUtc) return undefined;
  return dateUtc ? `${dateUtc}T${timeUtc}Z` : timeUtc;
}

/**
 * 最新のテレメトリから記録候補の 1 点を作る。測位解が無ければ null。
 *
 * 受信時刻は呼び出し側から渡す。テレメトリの lastReceivedAt をそのまま使えるが、
 * まだ一度も受信していない場合の既定値を呼び出し側で決められるようにしている。
 */
export function toTrackPoint(telemetry: Telemetry, at: number): TrackPoint | null {
  if (!hasPosition(telemetry)) return null;
  return {
    at,
    utc: formatUtcTimestamp(telemetry.dateUtc, telemetry.timeUtc),
    latitude: telemetry.latitude as number,
    longitude: telemetry.longitude as number,
    altitude: telemetry.altitude,
    quality: telemetry.quality,
    satellitesUsed: telemetry.satellitesUsed,
    hdop: telemetry.hdop,
    horizontalError: telemetry.horizontalError,
    verticalError: telemetry.verticalError,
    speedKmh: telemetry.speedKmh,
    course: telemetry.course,
  };
}

/**
 * 候補の点を軌跡へ積むかどうか。
 *
 * テレメトリは受信チャンクごとに更新されるため、素直に積むと
 * 同じ座標が 1 秒に何度も入る。受信機の申告する UTC が前の点と同じなら、
 * 同一エポックの GGA / RMC / NAV-PVT が重複しているとみなして捨てる。
 */
export function shouldRecordPoint(
  previous: TrackPoint | undefined,
  candidate: TrackPoint,
  intervalMs: number,
): boolean {
  if (!previous) return true;
  if (candidate.utc !== undefined && candidate.utc === previous.utc) return false;
  const elapsed = candidate.at - previous.at;
  // PC の時計が巻き戻った場合、間隔の判定では永久に条件を満たせなくなる。
  // 記録が止まったまま気付けないより、1 点余分に積むほうが害が小さい
  if (elapsed < 0) return true;
  return elapsed >= intervalMs;
}

/**
 * 連続する 2 点の距離（m）。移動距離の足し上げに使う。
 *
 * 閾値未満の変位は 0 として扱う。静止していても搬送波位相解は cm 単位で揺れるため、
 * そのまま足すと動いていないのに距離が伸び続けてしまう。
 * Fix ロストを跨いだ区間は、実際の経路が分からないので直線距離で概算する。
 */
export function stepDistanceMeters(previous: TrackPoint, current: TrackPoint): number {
  const meters = calculateDistanceKm(
    previous.latitude, previous.longitude, current.latitude, current.longitude,
  ) * 1000;
  return meters >= TRACK_DISTANCE_EPSILON_M ? meters : 0;
}

/** 軌跡を集計する。空配列なら 0 件として返す */
export function summarizeTrack(points: TrackPoint[]): TrackSummary {
  if (points.length === 0) return { count: 0, distanceMeters: 0, durationMs: 0 };

  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    distanceMeters += stepDistanceMeters(points[index - 1], points[index]);
  }

  const startedAt = points[0].at;
  const endedAt = points[points.length - 1].at;
  return {
    count: points.length,
    distanceMeters,
    durationMs: Math.max(0, endedAt - startedAt),
    startedAt,
    endedAt,
  };
}

/** 軌跡点の測位品質に対応する色調。地図のマーカーと同じ体系を使う */
export function trackPointTone(point: TrackPoint): QualityTone {
  return resolveQualityDisplay(point.quality, '').tone;
}

/**
 * 欠測でひとつながりの軌跡を分ける。
 *
 * gapMs を超えて間隔が空いた区間は、実際にどこを通ったか分からない。
 * 直線で結ぶと通っていない経路を描くことになるため、別の連なりとして扱う。
 */
export function splitTrackByGap(points: TrackPoint[], gapMs: number = TRACK_GAP_MS): TrackPoint[][] {
  const groups: TrackPoint[][] = [];
  let current: TrackPoint[] = [];

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && point.at - previous.at > gapMs) {
      groups.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

/** ライン 1 本ぶんのプロパティ。地図の色分けと書き出した GeoJSON の双方で使う */
export type TrackSegmentProperties = {
  tone: QualityTone;
  quality?: number;
  startedAt: number;
  endedAt: number;
  pointCount: number;
};

/** `points[from]` から `points[to]` までを 1 本のラインにする。2 点に満たなければ作らない */
function toSegmentFeature(
  points: TrackPoint[],
  from: number,
  to: number,
): Feature<LineString, TrackSegmentProperties> | null {
  if (to - from + 1 < 2) return null;

  const coordinates: [number, number][] = [];
  for (let index = from; index <= to; index += 1) {
    coordinates.push([points[index].longitude, points[index].latitude]);
  }

  return {
    type: 'Feature',
    properties: {
      // 色調を決めたのは先頭の点。終端は品質が変わった次の区間の起点でもあるため、
      // そちらから取ると tone と食い違う
      tone: trackPointTone(points[from]),
      quality: points[from].quality,
      startedAt: points[from].at,
      endedAt: points[to].at,
      pointCount: to - from + 1,
    },
    geometry: { type: 'LineString', coordinates },
  };
}

/** 区間への切り分け結果 */
type WalkedSegments = {
  /** 終わりが確定した区間。点が後ろへ足されても二度と変わらない */
  closed: Feature<LineString, TrackSegmentProperties>[];
  /** まだ伸びうる末尾の区間。2 点に満たなければ null */
  open: Feature<LineString, TrackSegmentProperties> | null;
  /** 末尾の区間が始まる `points` 上の位置 */
  openStart: number;
};

/**
 * `startIndex` 以降を区間へ切り分ける。
 *
 * 欠測での分割に加えて、測位品質が変わる位置でも線を切る。区間ごとに色を変えるためで、
 * 境目の点は前後の区間が共有するので、見た目が途切れることも線が重なることもない。
 *
 * 確定した区間と末尾の区間を分けて返すのは、点が後ろへ足されるだけの記録中に
 * 全体を組み直さずに済ませるため（{@link createTrackFeatureBuilder} が使う）。
 */
function walkTrackSegments(points: TrackPoint[], startIndex: number, gapMs: number): WalkedSegments {
  const closed: Feature<LineString, TrackSegmentProperties>[] = [];
  let segmentStart = Math.min(Math.max(startIndex, 0), Math.max(points.length - 1, 0));
  let tone: QualityTone | undefined = points.length > segmentStart
    ? trackPointTone(points[segmentStart])
    : undefined;

  const close = (to: number) => {
    const feature = toSegmentFeature(points, segmentStart, to);
    if (feature) closed.push(feature);
  };

  for (let index = segmentStart + 1; index < points.length; index += 1) {
    const pointTone = trackPointTone(points[index]);

    // 欠測。実際にどこを通ったか分からないので、境目の点は共有せず別の連なりにする
    if (points[index].at - points[index - 1].at > gapMs) {
      close(index - 1);
      segmentStart = index;
      tone = pointTone;
      continue;
    }

    // 品質の境目。変化した点を前後の区間で共有することで、
    // 同じ線分を二重に描かずに線を繋げる。
    // 境目へ入る 1 区間は、変化する前の色のまま描かれる
    if (pointTone !== tone) {
      close(index);
      segmentStart = index;
      tone = pointTone;
    }
  }

  return { closed, open: toSegmentFeature(points, segmentStart, points.length - 1), openStart: segmentStart };
}

/**
 * 軌跡を地図に描けるライン群へ変換する。
 *
 * 点が 1 つしか無い区間は LineString として成立しないので落とす。
 */
export function buildTrackFeatures(
  points: TrackPoint[],
  gapMs: number = TRACK_GAP_MS,
): FeatureCollection<LineString, TrackSegmentProperties> {
  const { closed, open } = walkTrackSegments(points, 0, gapMs);
  return { type: 'FeatureCollection', features: open ? [...closed, open] : closed };
}

/**
 * 前回の結果を引き継いで軌跡のライン群を組み立てる関数を作る。
 *
 * 記録中は 1 点ずつ後ろへ足されるだけなのに、毎回すべての点からライン群を組み直すと、
 * 軌跡が伸びるほど 1 点あたりのコストが増えていく（上限の 50,000 点では毎秒数 ms）。
 * 点を足して変わりうるのは末尾の区間だけなので、確定した区間は作り直さず使い回す。
 *
 * 渡された配列が短くなった場合と先頭の点が入れ替わった場合は、別の軌跡に
 * 差し替わったとみなして最初から組み直す（記録の消去・再開・一時的な非表示）。
 */
export function createTrackFeatureBuilder(gapMs: number = TRACK_GAP_MS) {
  let completed: Feature<LineString, TrackSegmentProperties>[] = [];
  let openStart = 0;
  let knownLength = 0;
  let knownFirst: TrackPoint | undefined;

  return function buildIncrementally(
    points: TrackPoint[],
  ): FeatureCollection<LineString, TrackSegmentProperties> {
    if (points.length < knownLength || points[0] !== knownFirst) {
      completed = [];
      openStart = 0;
    }
    knownLength = points.length;
    knownFirst = points[0];

    const walked = walkTrackSegments(points, openStart, gapMs);
    if (walked.closed.length > 0) completed = [...completed, ...walked.closed];
    openStart = walked.openStart;

    return {
      type: 'FeatureCollection',
      features: walked.open ? [...completed, walked.open] : completed,
    };
  };
}

/** 軌跡の始点。地図に開始位置の印を打つために使う */
export function buildTrackStartFeature(points: TrackPoint[]): FeatureCollection<Point> {
  if (points.length === 0) return { type: 'FeatureCollection', features: [] };
  const first = points[0];
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { at: first.at },
      geometry: { type: 'Point', coordinates: [first.longitude, first.latitude] },
    }],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 数値として妥当なら返す。壊れた保存データから読み戻すときに使う */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 保存済みレコードを軌跡点へ戻す。座標か時刻を欠くものは復元できないため null。
 *
 * 保存先が壊れていた場合に例外で復元全体を落とさず、読める点だけを拾えるようにする。
 */
export function normalizeStoredPoint(value: unknown): TrackPoint | null {
  if (!isRecord(value)) return null;
  const at = optionalNumber(value.at);
  const latitude = optionalNumber(value.latitude);
  const longitude = optionalNumber(value.longitude);
  if (at === undefined || latitude === undefined || longitude === undefined) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return {
    at,
    utc: typeof value.utc === 'string' ? value.utc : undefined,
    latitude,
    longitude,
    altitude: optionalNumber(value.altitude),
    quality: optionalNumber(value.quality),
    satellitesUsed: optionalNumber(value.satellitesUsed),
    hdop: optionalNumber(value.hdop),
    horizontalError: optionalNumber(value.horizontalError),
    verticalError: optionalNumber(value.verticalError),
    speedKmh: optionalNumber(value.speedKmh),
    course: optionalNumber(value.course),
  };
}
