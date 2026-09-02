import type { SatelliteBreakdown } from './gnssSystem';

/** 受信機から読み取った最新の測位状態。各フィールドは未取得なら undefined */
export type Telemetry = {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  geoidSeparation?: number;
  quality?: number;
  satellitesUsed?: number;
  satellitesInView?: number;
  satellitesUsedBreakdown?: SatelliteBreakdown;
  satellitesInViewBreakdown?: SatelliteBreakdown;
  hdop?: number;
  pdop?: number;
  vdop?: number;
  speedKmh?: number;
  course?: number;
  timeUtc?: string;
  dateUtc?: string;
  horizontalError?: number;
  verticalError?: number;
  lastReceivedAt?: number;
};

/**
 * 測位座標が得られているか。
 * 複数のパネルが同じ判定をするため、定義を 1 つに保つ。
 */
export function hasPosition(telemetry: Telemetry): boolean {
  return telemetry.latitude !== undefined && telemetry.longitude !== undefined;
}

/**
 * 測位解が失われたときに、意味を失う位置系フィールドを明示的に無効化する。
 *
 * ここで消すのは「測位解そのものに由来し、どの電文から来ても無意味になる」項目だけ。
 * DOP や速度・方位は電文ごとに載っているものが違うため、
 * 各パーサが自分の電文に含まれる分だけを追加で消す（例: GGA なら HDOP、NAV-PVT なら PDOP と速度・方位）。
 *
 * 消さずに放置すると、Fix が外れた後も直前の座標や誤差がそのまま画面に残ってしまう。
 */
export function clearPositionFields(update: Partial<Telemetry>): void {
  update.latitude = undefined;
  update.longitude = undefined;
  update.altitude = undefined;
  update.geoidSeparation = undefined;
  update.horizontalError = undefined;
  update.verticalError = undefined;
}

/**
 * 同一エポックの判定に使う、秒までの UTC 時刻。
 * GGA は小数秒（12:34:56.00）を持ち NAV-PVT は持たないため、秒で切り揃えて比べる。
 */
export function positionEpoch(timeUtc: string | undefined): string | undefined {
  return timeUtc === undefined || timeUtc.length < 8 ? undefined : timeUtc.slice(0, 8);
}

/**
 * NMEA 由来の差分から、UBX が同じエポックで既に出している座標を外す。
 *
 * 受信機は 1 エポックの測位解を NAV-PVT と GGA / RMC の両方で出す。NAV-PVT は 1e-7 度
 * （約 1 cm）で座標を持つが、NMEA は既定では分の小数 5 桁（約 1.9 cm）しか持たない。
 * 到着順は決まっておらず、素直に後勝ちで重ねると細かい座標を粗い座標が上書きしてしまう。
 * 拡大プロットでは cm 単位の格子への吸い付きとして見えるため、UBX 側が同じエポックを
 * 既に持っていれば NMEA 側の座標は捨てる。測位品質や衛星数など座標以外はそのまま残す。
 *
 * 測位できていないときの undefined での上書き（{@link clearPositionFields}）は通す。
 * 座標を持たない差分に「UBX が同じ座標を持っている」は成り立たないため。
 */
export function dropNmeaPositionCoveredByUbx(
  update: Partial<Telemetry>,
  ubxEpoch: string | undefined,
): Partial<Telemetry> {
  if (ubxEpoch === undefined || update.latitude === undefined) return update;
  if (positionEpoch(update.timeUtc) !== ubxEpoch) return update;
  const stripped = { ...update };
  delete stripped.latitude;
  delete stripped.longitude;
  delete stripped.altitude;
  delete stripped.geoidSeparation;
  return stripped;
}
