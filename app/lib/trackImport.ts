import { GGA_QUALITY } from './constants';
import { resolveQualityDisplay } from './correctionSource';
import type { TrackPoint } from './track';

/** 読み込める形式。{@link ./trackExport} が書き出すものと同じ */
export type TrackImportFormat = 'csv' | 'gpx' | 'geojson';

export type ImportedTrack = {
  format: TrackImportFormat;
  points: TrackPoint[];
};

/** 時刻を持たない記録に与える点の間隔（ms）。それでも一定の歩みで再生できるようにする */
const FALLBACK_STEP_MS = 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 数値として妥当なら返す */
function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const isWithinBounds = (latitude: number, longitude: number) =>
  Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

/** 画面と同じ短いラベル（FIX / FLOAT など）から測位品質コードへ戻す。CSV と GPX が持つ */
const QUALITY_BY_LABEL = new Map<string, number>(
  Object.values(GGA_QUALITY).map((code) => [resolveQualityDisplay(code, '').short, code]),
);

function qualityFromLabel(label: string | undefined): number | undefined {
  return label === undefined ? undefined : QUALITY_BY_LABEL.get(label.trim().toUpperCase());
}

/** 書き出しの time_local（YYYY-MM-DD HH:MM:SS）をローカル時刻として epoch ms へ戻す */
export function parseLocalTimestamp(text: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text?.trim() ?? '');
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/** ISO 8601 の文字列なら epoch ms。日付を持たない時刻だけの文字列は undefined */
function parseIsoTimestamp(text: string | undefined): number | undefined {
  if (!text || !text.includes('T')) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 点の時刻を決める。候補を先頭から使い、どれも無ければ直前の点から一定間隔で進める。
 * 再生は点と点の間隔だけを見るため、どれで決めても歩みは揃う。
 */
function resolveAt(candidates: Array<number | undefined>, previousAt: number | undefined): number {
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate;
  }
  return previousAt === undefined ? 0 : previousAt + FALLBACK_STEP_MS;
}

/** CSV の 1 行をセルに分ける。引用符で囲まれたセルの中の区切りと二重引用符を扱う */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/**
 * 本アプリが書き出した CSV を読む。
 * 列は見出し名で引くので、列の並びや余分な列は問わない。緯度経度を欠く行は飛ばす。
 */
export function parseTrackCsv(text: string): TrackPoint[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((name) => name.trim().toLowerCase());
  const latitudeIndex = header.indexOf('latitude');
  const longitudeIndex = header.indexOf('longitude');
  if (latitudeIndex < 0 || longitudeIndex < 0) return [];

  const points: TrackPoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const read = (name: string): string | undefined => {
      const index = header.indexOf(name);
      const value = index < 0 ? undefined : cells[index]?.trim();
      return value === '' ? undefined : value;
    };
    const latitude = optionalNumber(cells[latitudeIndex]);
    const longitude = optionalNumber(cells[longitudeIndex]);
    if (latitude === undefined || longitude === undefined || !isWithinBounds(latitude, longitude)) continue;

    const utc = read('time_utc');
    const previous = points[points.length - 1];
    points.push({
      at: resolveAt([parseIsoTimestamp(utc), parseLocalTimestamp(read('time_local'))], previous?.at),
      utc,
      latitude,
      longitude,
      altitude: optionalNumber(read('altitude_m')),
      quality: optionalNumber(read('quality')) ?? qualityFromLabel(read('quality_label')),
      satellitesUsed: optionalNumber(read('satellites_used')),
      hdop: optionalNumber(read('hdop')),
      horizontalError: optionalNumber(read('horizontal_error_m')),
      verticalError: optionalNumber(read('vertical_error_m')),
      speedKmh: optionalNumber(read('speed_kmh')),
      course: optionalNumber(read('course_deg')),
    });
  }
  return points;
}

const TRACK_POINT_PATTERN = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;

const readAttribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)?.[1];

const readElement = (body: string, name: string): string | undefined =>
  new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`, 'i').exec(body)?.[1];

/** XML の実体参照のうち、書き出し側（trackExport の escapeXml）が使うものを戻す */
function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * GPX 1.1 の trkpt を読む。
 *
 * DOMParser に頼らないのは、テストでも同じ関数をそのまま動かすため。
 * 本アプリの書き出しは 1 要素 1 行の素直な構造なので、正規表現で足りる。
 * 測位品質は type 要素に画面と同じ短いラベルで入っている。
 */
export function parseTrackGpx(text: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const match of text.matchAll(TRACK_POINT_PATTERN)) {
    const [, attributes, body] = match;
    const latitude = optionalNumber(readAttribute(attributes, 'lat'));
    const longitude = optionalNumber(readAttribute(attributes, 'lon'));
    if (latitude === undefined || longitude === undefined || !isWithinBounds(latitude, longitude)) continue;

    const time = readElement(body, 'time');
    const label = readElement(body, 'type');
    const previous = points[points.length - 1];
    points.push({
      at: resolveAt([parseIsoTimestamp(time)], previous?.at),
      utc: time,
      latitude,
      longitude,
      altitude: optionalNumber(readElement(body, 'ele')),
      quality: qualityFromLabel(label === undefined ? undefined : unescapeXml(label)),
      satellitesUsed: optionalNumber(readElement(body, 'sat')),
      hdop: optionalNumber(readElement(body, 'hdop')),
    });
  }
  return points;
}

/**
 * 本アプリが書き出した GeoJSON を読む。
 *
 * 書き出しはラインごとに開始・終了時刻しか持たず、点ごとの時刻は失われている。
 * そこで各ラインの点を開始から終了まで等間隔に並べ直す。記録どおりの歩みが要るなら CSV か GPX を使う。
 * 隣り合うラインは境目の点を共有しているので、ラインの先頭が直前の点と同じ座標なら積まない。
 */
export function parseTrackGeoJson(text: string): TrackPoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const features: unknown[] = parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)
    ? parsed.features
    : parsed.type === 'Feature' ? [parsed] : [];

  const points: TrackPoint[] = [];
  for (const feature of features) {
    if (!isRecord(feature) || !isRecord(feature.geometry) || feature.geometry.type !== 'LineString') continue;
    const coordinates: unknown[] = Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [];
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const startedAt = optionalNumber(properties.startedAt);
    const endedAt = optionalNumber(properties.endedAt);
    const quality = optionalNumber(properties.quality);
    const stepMs = startedAt !== undefined && endedAt !== undefined && coordinates.length > 1
      ? (endedAt - startedAt) / (coordinates.length - 1)
      : undefined;

    coordinates.forEach((coordinate, index) => {
      if (!Array.isArray(coordinate)) return;
      const longitude = optionalNumber(coordinate[0]);
      const latitude = optionalNumber(coordinate[1]);
      if (latitude === undefined || longitude === undefined || !isWithinBounds(latitude, longitude)) return;

      const previous = points[points.length - 1];
      if (index === 0 && previous && previous.latitude === latitude && previous.longitude === longitude) return;

      const interpolated = startedAt !== undefined && stepMs !== undefined
        ? Math.round(startedAt + stepMs * index)
        : undefined;
      points.push({
        at: resolveAt([interpolated], previous?.at),
        latitude,
        longitude,
        altitude: optionalNumber(coordinate[2]),
        quality,
      });
    });
  }
  return points;
}

/** 先頭の数百文字から形式を見分ける。拡張子は当てにしない（名前を変えて渡されることがある） */
export function detectTrackFormat(text: string): TrackImportFormat | null {
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 512);
  if (head.startsWith('{') || head.startsWith('[')) return 'geojson';
  if (head.startsWith('<')) return /<gpx[\s>]/i.test(head) ? 'gpx' : null;
  const firstLine = head.split(/\r?\n/)[0] ?? '';
  if (/\blatitude\b/i.test(firstLine) && /\blongitude\b/i.test(firstLine)) return 'csv';
  return null;
}

/**
 * 記録ファイルを読み込んで軌跡点に戻す。
 * 形式が分からない、または点が 1 つも無いときは、利用者へそのまま見せられる文言の例外を投げる。
 */
export function importTrack(text: string): ImportedTrack {
  const format = detectTrackFormat(text);
  if (format === null) {
    throw new Error('このファイルの形式は読み込めません。本アプリで書き出した CSV / GPX / GeoJSON を選んでください。');
  }
  const points = format === 'csv'
    ? parseTrackCsv(text)
    : format === 'gpx'
      ? parseTrackGpx(text)
      : parseTrackGeoJson(text);
  if (points.length === 0) throw new Error('位置情報の点が 1 つも見つかりませんでした。');
  return { format, points };
}
