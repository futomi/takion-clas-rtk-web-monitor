import { GGA_QUALITY, PLOT_MAX_SAMPLES, PLOT_TRAIL_MS } from './constants';
import { toLocalOffsetMeters } from './geo';
import type { TrackPoint } from './track';

/**
 * 拡大プロットの原点。
 *
 * 自動で置いたか手で置いたかを持つのは、自動で置いた原点だけを後から置き直すため。
 * Float のうちに置いた原点は、Fix した瞬間に数十 cm から数 m ずれる。
 */
export type PlotOrigin = {
  latitude: number;
  longitude: number;
  altitude?: number;
  quality?: number;
  isManual: boolean;
};

/** 原点から見た 1 点の位置（m）。up は標高差で、どちらかの標高が無ければ undefined */
export type PlanePosition = {
  east: number;
  north: number;
  up?: number;
  /** 水平距離 */
  distance: number;
};

export function originFromPoint(point: TrackPoint, isManual: boolean): PlotOrigin {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude,
    quality: point.quality,
    isManual,
  };
}

/** 原点から見た点の位置を求める */
export function toPlanePosition(origin: PlotOrigin, point: TrackPoint): PlanePosition {
  const { east, north } = toLocalOffsetMeters(origin.latitude, origin.longitude, point.latitude, point.longitude);
  const up = origin.altitude !== undefined && point.altitude !== undefined
    ? point.altitude - origin.altitude
    : undefined;
  return { east, north, up, distance: Math.hypot(east, north) };
}

/**
 * 新しい点を受けて原点を置き直すべきか。置き直すなら新しい原点、据え置きなら null。
 *
 * - 原点が無ければ最初の点をそのまま原点にする
 * - 自動で置いた原点が Fix 以外の解に基づいていて、初めて Fix の点が来たら置き直す。
 *   Float から Fix へ収束する瞬間は位置が大きく飛ぶため、古い原点のままだと点が範囲の外へ消える
 * - 手で置いた原点は触らない
 */
export function chooseOrigin(origin: PlotOrigin | null, point: TrackPoint): PlotOrigin | null {
  if (origin === null) return originFromPoint(point, false);
  if (origin.isManual) return null;
  const originIsFix = origin.quality === GGA_QUALITY.PRECISE_FIX;
  if (!originIsFix && point.quality === GGA_QUALITY.PRECISE_FIX) return originFromPoint(point, false);
  return null;
}

/** 同じエポックの点か。UTC が両方あればそれで、無ければ受信時刻と座標で判断する */
function isSameEpoch(a: TrackPoint, b: TrackPoint): boolean {
  if (a.utc !== undefined && b.utc !== undefined) return a.utc === b.utc;
  return a.at === b.at && a.latitude === b.latitude && a.longitude === b.longitude;
}

/** 描画に関わる値がすべて同じか。同じなら差し替えても見た目が変わらない */
function hasSameDrawing(a: TrackPoint, b: TrackPoint): boolean {
  return a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.altitude === b.altitude
    && a.quality === b.quality
    && a.horizontalError === b.horizontalError
    && a.verticalError === b.verticalError;
}

/**
 * 点列へ新しい点を積む。
 *
 * テレメトリは受信チャンクごとに更新されるので、同じエポックの点が何度も届く。
 * 同じエポックなら末尾を差し替える。後から来たぶんのほうが情報が揃っている
 * （NAV-PVT と GGA の両方を取り込み終えている）ため。
 *
 * 古い点は最新の点から trailMs より前のものを落とす。壁時計ではなく点の時刻で測るので、
 * 記録の再生でも実測と同じ長さの尾が残る。
 *
 * 変化が無ければ同じ配列をそのまま返す。呼び出し側はそれで描き直しを省ける。
 */
export function appendPlotSample(
  samples: TrackPoint[],
  candidate: TrackPoint,
  trailMs: number = PLOT_TRAIL_MS,
  maxSamples: number = PLOT_MAX_SAMPLES,
): TrackPoint[] {
  const last = samples[samples.length - 1];
  let next: TrackPoint[];
  if (last && isSameEpoch(last, candidate)) {
    if (hasSameDrawing(last, candidate)) return samples;
    next = [...samples.slice(0, -1), candidate];
  } else {
    next = [...samples, candidate];
  }

  const oldest = candidate.at - trailMs;
  let firstKept = 0;
  while (firstKept < next.length - 1 && next[firstKept].at < oldest) firstKept += 1;
  if (next.length - firstKept > maxSamples) firstKept = next.length - maxSamples;
  return firstKept > 0 ? next.slice(firstKept) : next;
}

/** 尾の不透明度。最新の点で 1、trailMs 前で 0.15 まで直線的に薄くする */
export function trailOpacity(ageMs: number, trailMs: number = PLOT_TRAIL_MS): number {
  if (trailMs <= 0) return 1;
  const ratio = Math.min(1, Math.max(0, ageMs / trailMs));
  return 1 - ratio * 0.85;
}

/** 格子の間隔（m）。細い線と太い線の 2 段 */
export type GridSpacing = { minor: number; major: number };

/**
 * 表示半幅に応じた格子の間隔。
 * 半幅 1 m なら 10 cm ごとに線を引き、広げるほど粗くして線が詰まりすぎないようにする。
 */
export function gridSpacingFor(rangeMeters: number): GridSpacing {
  if (rangeMeters <= 1) return { minor: 0.1, major: 0.5 };
  if (rangeMeters <= 2) return { minor: 0.1, major: 1 };
  return { minor: 0.5, major: 1 };
}

/** 格子の目盛りラベル。整数なら小数を出さない */
export function formatGridLabel(meters: number): string {
  const text = Number.isInteger(meters) ? meters.toFixed(0) : meters.toFixed(1);
  return `${text} m`;
}

/**
 * 長さを人が読む形に整える。1 m 未満は cm（小数 1 桁）、それ以上は m（小数 2 桁）。
 * signed を指定すると符号を付ける。丸めて 0 になる値には付けない（「+0.0 cm」と読ませないため）。
 */
export function formatPlaneLength(meters: number, options: { signed?: boolean } = {}): string {
  const magnitude = Math.abs(meters);
  const centimeters = Math.round(magnitude * 1000) / 10;
  const body = centimeters < 100 ? `${centimeters.toFixed(1)} cm` : `${magnitude.toFixed(2)} m`;
  if (!options.signed || centimeters === 0) return body;
  return `${meters < 0 ? '-' : '+'}${body}`;
}

/** 表示範囲に収めた位置。範囲の外なら縁に沿った点と、外にあったという印を返す */
export type ClampedPosition = { east: number; north: number; isOutside: boolean };

/**
 * 点を東西 ±eastLimit・南北 ±northLimit の矩形へ収める。
 * 外にある点は原点からの向きを保ったまま縁まで縮める。範囲の外へ出た受信機が
 * どちらの方向にいるかを、縁の矢印で示すために使う。
 */
export function clampToBounds(
  east: number,
  north: number,
  eastLimit: number,
  northLimit: number,
): ClampedPosition {
  const eastRatio = eastLimit > 0 ? Math.abs(east) / eastLimit : Infinity;
  const northRatio = northLimit > 0 ? Math.abs(north) / northLimit : Infinity;
  const overflow = Math.max(eastRatio, northRatio);
  if (!(overflow > 1)) return { east, north, isOutside: false };
  return { east: east / overflow, north: north / overflow, isOutside: true };
}
