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
