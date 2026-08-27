import { GGA_QUALITY, TRACK_GAP_MS } from './constants';
import { resolveQualityDisplay } from './correctionSource';
import { buildTrackFeatures, splitTrackByGap, type TrackPoint } from './track';

/** 書き出せる形式。UI のボタンと拡張子はこの一覧から作る */
export const TRACK_EXPORT_FORMATS = ['csv', 'gpx', 'geojson'] as const;
export type TrackExportFormat = (typeof TRACK_EXPORT_FORMATS)[number];

/** GPX 内でアプリを名乗る文字列 */
const CREATOR = 'Takion CLAS / RTK Web Monitor';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** epoch ms をローカル時刻の YYYY-MM-DD HH:MM:SS に整形する */
export function formatLocalTimestamp(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 書き出しに使う ISO 8601 の時刻。
 *
 * 受信機が日付まで申告していればそれを使い、時刻しか無い（あるいは何も無い）場合は
 * PC の受信時刻で代用する。GPX や GeoJSON では時刻が欠けた点があると扱いづらいため、
 * 精度は落ちても必ず値を入れる。
 */
export function resolveIsoTime(point: TrackPoint): string {
  if (point.utc?.includes('T')) return point.utc;
  return new Date(point.at).toISOString();
}

/** 開始時刻から書き出しファイル名を組み立てる */
export function buildTrackFileName(startedAt: number, format: TrackExportFormat): string {
  const date = new Date(startedAt);
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `track_${stamp}.${format}`;
}

/** 測位品質の短いラベル。CSV と GPX の双方で画面と同じ呼び方を使う */
const qualityLabel = (quality: number | undefined) => resolveQualityDisplay(quality, '').short;

/** CSV の 1 セル。区切り・引用符・改行を含む値だけを引用符で囲む */
function toCsvCell(value: string | number | undefined): string {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 数値を固定小数で。未取得なら空欄にする（0 と区別できなくなるため 0 で埋めない） */
const fixed = (value: number | undefined, digits: number) => (value === undefined ? undefined : value.toFixed(digits));

/**
 * CSV の先頭に付ける BOM。
 * これが無いと Excel が UTF-8 と判断せず、日本語のラベル列が文字化けする。
 */
const UTF8_BOM = '\uFEFF';

const CSV_HEADER = [
  'index', 'time_local', 'time_utc', 'latitude', 'longitude', 'altitude_m',
  'quality', 'quality_label', 'satellites_used', 'hdop',
  'horizontal_error_m', 'vertical_error_m', 'speed_kmh', 'course_deg',
];

/**
 * 軌跡を CSV へ書き出す。
 *
 * 先頭に BOM を付け、改行を CRLF にしているのは Excel で開いたときに
 * 文字化けと行崩れを起こさないため。
 */
export function formatTrackCsv(points: TrackPoint[]): string {
  const rows = points.map((point, index) => [
    index + 1,
    formatLocalTimestamp(point.at),
    point.utc,
    // 緯度経度は 8 桁（およそ 1mm）まで残す。cm 級測位の値を丸めてしまわないため
    point.latitude.toFixed(8),
    point.longitude.toFixed(8),
    fixed(point.altitude, 3),
    point.quality,
    qualityLabel(point.quality),
    point.satellitesUsed,
    fixed(point.hdop, 2),
    fixed(point.horizontalError, 3),
    fixed(point.verticalError, 3),
    fixed(point.speedKmh, 2),
    fixed(point.course, 1),
  ].map(toCsvCell).join(','));

  return `${UTF8_BOM}${[CSV_HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}

/** XML のテキストと属性値で意味を持つ文字を実体参照へ置き換える */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 測位品質を GPX の fix 要素が許す語へ寄せる。
 * RTK に対応する語が無いため、補正付きの解はいずれも dgps として書き出す。
 */
function toGpxFix(quality: number | undefined): string | undefined {
  switch (quality) {
    case GGA_QUALITY.NO_FIX:
    case GGA_QUALITY.DEAD_RECKONING:
      return 'none';
    case GGA_QUALITY.STANDALONE:
      return '3d';
    case GGA_QUALITY.DGPS:
    case GGA_QUALITY.PRECISE_FIX:
    case GGA_QUALITY.PRECISE_FLOAT:
      return 'dgps';
    default:
      return undefined;
  }
}

/** 値があるときだけ要素を書く。GPX は空要素を嫌うスキーマなので undefined は落とす */
const element = (name: string, value: string | number | undefined, indent: string) =>
  (value === undefined ? [] : [`${indent}<${name}>${escapeXml(String(value))}</${name}>`]);

/**
 * 軌跡を GPX 1.1 へ書き出す。
 *
 * 欠測ごとに trkseg を分けるため、Fix ロストを跨いだ区間が
 * 地図ソフト上で 1 本の直線として繋がって見えることはない。
 * 子要素の並びは GPX の wptType が定める順序に従う。
 */
export function formatTrackGpx(points: TrackPoint[], name: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeXml(CREATOR)}" xmlns="http://www.topografix.com/GPX/1/1">`,
    '  <metadata>',
    `    <name>${escapeXml(name)}</name>`,
    ...(points.length > 0 ? [`    <time>${resolveIsoTime(points[0])}</time>`] : []),
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
  ];

  for (const segment of splitTrackByGap(points, TRACK_GAP_MS)) {
    lines.push('    <trkseg>');
    for (const point of segment) {
      lines.push(`      <trkpt lat="${point.latitude.toFixed(8)}" lon="${point.longitude.toFixed(8)}">`);
      lines.push(...element('ele', fixed(point.altitude, 3), '        '));
      lines.push(...element('time', resolveIsoTime(point), '        '));
      lines.push(...element('type', qualityLabel(point.quality), '        '));
      lines.push(...element('fix', toGpxFix(point.quality), '        '));
      lines.push(...element('sat', point.satellitesUsed, '        '));
      lines.push(...element('hdop', fixed(point.hdop, 2), '        '));
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
  }

  lines.push('  </trk>', '</gpx>', '');
  return lines.join('\n');
}

/**
 * 軌跡を GeoJSON へ書き出す。
 *
 * 地図上の描画と同じ分割規則（欠測と測位品質）でラインを切り出すため、
 * 読み込んだ側でも品質ごとに色を塗り分けられる。
 * 点ごとの詳細な測位情報は CSV が受け持つ。
 */
export function formatTrackGeoJson(points: TrackPoint[]): string {
  return `${JSON.stringify(buildTrackFeatures(points, TRACK_GAP_MS), null, 2)}\n`;
}

/** 書き出し形式ごとの MIME タイプ。Blob を組み立てるときに使う */
const MIME_TYPES: Record<TrackExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  gpx: 'application/gpx+xml;charset=utf-8',
  geojson: 'application/geo+json;charset=utf-8',
};

/** 書き出したファイルの中身とファイル名 */
export type TrackExport = {
  fileName: string;
  mimeType: string;
  content: string;
};

/** 指定形式で軌跡を書き出す。ファイル名は記録開始時刻から決まる */
export function exportTrack(points: TrackPoint[], format: TrackExportFormat, startedAt: number): TrackExport {
  const fileName = buildTrackFileName(startedAt, format);
  const content = format === 'csv'
    ? formatTrackCsv(points)
    : format === 'gpx'
      ? formatTrackGpx(points, fileName.replace(/\.gpx$/, ''))
      : formatTrackGeoJson(points);
  return { fileName, mimeType: MIME_TYPES[format], content };
}
