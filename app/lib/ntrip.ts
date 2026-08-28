import { calculateDistanceKm } from './geo';

/** NTRIP Caster の Source-table に含まれる 1 配信局（STR レコード） */
export type MountpointRecord = {
  mountpoint: string;
  identifier: string;
  format: string;
  formatDetails: string;
  carrier: number;
  navSystem: string;
  network: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  nmea: boolean;
  solution: number;
  generator: string;
  authentication: string;
  fee: boolean;
  bitrate: number;
};

/**
 * 配信局のうち、画面が実際に使う列だけを取り出した形。
 *
 * Source-table には STR 行の全 17 列が載るが、選択 UI が読むのは名前・形式・国と
 * 距離計算用の座標だけで、残りの列は一度も参照されない。公開 Caster では配信局が
 * 数百局規模になるため、ブラウザへ渡す前にここへ落として転送量を削る
 * （rtk2go の実測で、生の Source-table 109 KB に対し落とした後は 68 KB）。
 */
export type MountpointSummary = Pick<
  MountpointRecord,
  'mountpoint' | 'format' | 'country' | 'latitude' | 'longitude'
>;

/** 解析済みの STR レコードを、ブラウザへ渡す形へ落とす */
export function toMountpointSummary(record: MountpointRecord): MountpointSummary {
  const { mountpoint, format, country, latitude, longitude } = record;
  return { mountpoint, format, country, latitude, longitude };
}

/** 現在位置からの距離を付与した配信局 */
export type MountpointCandidate = MountpointSummary & {
  distanceKm: number | null;
};

/** Source-table 取得 API のレスポンス */
export type SourceTableResponse = {
  host: string;
  port: number;
  count: number;
  records: MountpointSummary[];
};

/** NTRIP 接続に使う設定。パスワードは意図的に含めない（永続化対象外のため） */
export type NtripConnectionConfig = {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
};

/**
 * ポート番号として妥当な範囲かを検査する。
 *
 * API ルートの入力検査と、設定フォームの入力検査の双方が同じ判定を要る。
 * サーバー専用モジュールに置くとフォーム側から参照できないため、ここに置く。
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export const DEFAULT_NTRIP_HOST = 'rtk2go.com';
export const DEFAULT_NTRIP_PORT = 2101;
/** RTK2GO はパスワードを要求しないため、既定値として慣例的にこの文字列を送る */
export const DEFAULT_NTRIP_PASSWORD = 'none';

/** STR レコードの各列。NTRIP 1.0 の Source-table 仕様に準拠 */
const STR_FIELD = {
  MOUNTPOINT: 1,
  IDENTIFIER: 2,
  FORMAT: 3,
  FORMAT_DETAILS: 4,
  CARRIER: 5,
  NAV_SYSTEM: 6,
  NETWORK: 7,
  COUNTRY: 8,
  LATITUDE: 9,
  LONGITUDE: 10,
  NMEA: 11,
  SOLUTION: 12,
  GENERATOR: 13,
  AUTHENTICATION: 15,
  FEE: 16,
  BITRATE: 17,
} as const;

/**
 * 必須とみなす列数。マウントポイント〜NMEA フラグまでが揃っていれば受理する。
 * GENERATOR 以降の列は Caster によって省略されるため任意扱いとし、欠けた場合は既定値で埋める。
 */
const MIN_STR_FIELDS = STR_FIELD.NMEA + 1;

const toInt = (value: string | undefined) => Number.parseInt(value || '0', 10) || 0;
const toCoordinate = (value: string | undefined) => {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * NTRIP Caster が返す Source-table 本文を解析して配信局一覧を得る。
 *
 * HTTP ヘッダや CAS / NET レコードが混在していても、STR 行だけを拾うため前処理は不要。
 * 列が欠けた行はスキップする。
 */
export function parseSourceTable(rawText: string): MountpointRecord[] {
  const records: MountpointRecord[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith('STR;')) continue;
    const parts = line.split(';');
    if (parts.length < MIN_STR_FIELDS) continue;

    const mountpoint = parts[STR_FIELD.MOUNTPOINT] || '';
    if (!mountpoint) continue;

    records.push({
      mountpoint,
      identifier: parts[STR_FIELD.IDENTIFIER] || '',
      format: parts[STR_FIELD.FORMAT] || '',
      formatDetails: parts[STR_FIELD.FORMAT_DETAILS] || '',
      carrier: toInt(parts[STR_FIELD.CARRIER]),
      navSystem: parts[STR_FIELD.NAV_SYSTEM] || '',
      network: parts[STR_FIELD.NETWORK] || '',
      country: parts[STR_FIELD.COUNTRY] || '',
      latitude: toCoordinate(parts[STR_FIELD.LATITUDE]),
      longitude: toCoordinate(parts[STR_FIELD.LONGITUDE]),
      nmea: parts[STR_FIELD.NMEA] === '1',
      solution: toInt(parts[STR_FIELD.SOLUTION]),
      generator: parts[STR_FIELD.GENERATOR] || '',
      authentication: parts[STR_FIELD.AUTHENTICATION] || 'N',
      fee: parts[STR_FIELD.FEE] === 'Y',
      bitrate: toInt(parts[STR_FIELD.BITRATE]),
    });
  }

  return records;
}

/**
 * 配信局に現在位置からの距離を付けて並べ替える。
 *
 * 受信機がまだ測位していない場合は距離を計算できないため、
 * 国コード JPN を優先したうえでマウントポイント名のアルファベット順にする。
 */
export function rankMountpoints(
  records: MountpointSummary[],
  referenceLatitude: number | null,
  referenceLongitude: number | null,
): MountpointCandidate[] {
  const hasReference = referenceLatitude !== null && referenceLongitude !== null;

  const candidates: MountpointCandidate[] = records.map((record) => ({
    ...record,
    distanceKm:
      hasReference && record.latitude !== null && record.longitude !== null
        ? calculateDistanceKm(referenceLatitude, referenceLongitude, record.latitude, record.longitude)
        : null,
  }));

  if (hasReference) {
    // 座標を持たない配信局は距離不明として末尾に送る
    return candidates.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  return candidates.sort((a, b) => {
    if (a.country === 'JPN' && b.country !== 'JPN') return -1;
    if (a.country !== 'JPN' && b.country === 'JPN') return 1;
    return a.mountpoint.localeCompare(b.mountpoint);
  });
}
