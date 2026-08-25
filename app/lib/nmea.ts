import { GGA_QUALITY, KNOTS_TO_KMH, MAX_NMEA_BYTES } from './constants';
import { formatNmeaSummary } from './nmeaSummary';
import { clearPositionFields, type Telemetry } from './telemetry';
import type { GsaReport, GsvReport, ParsedMessage } from './types';

/** 文字列を有限数として解釈する。空文字や NaN は undefined */
export function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** NMEA の ddmm.mmmm 形式と N/S/E/W から十進度を求める */
export function parseCoordinate(value: string | undefined, hemisphere: string | undefined): number | undefined {
  const raw = parseNumber(value);
  if (raw === undefined || !hemisphere) return undefined;
  const degrees = Math.floor(raw / 100);
  const minutes = raw - degrees * 100;
  const decimal = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal;
}

/** hhmmss[.sss] を hh:mm:ss[.sss] に整形する */
export function formatNmeaTime(value: string | undefined): string | undefined {
  if (!value || value.length < 6) return undefined;
  const fraction = value.includes('.') ? `.${value.split('.')[1]}` : '';
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}${fraction}`;
}

/** ddmmyy を YYYY-MM-DD に整形する。2 桁年は 80 を境に 19xx / 20xx へ振り分ける */
export function formatNmeaDate(value: string | undefined): string | undefined {
  if (!value || value.length !== 6) return undefined;
  const year = Number(value.slice(4, 6));
  const fullYear = year >= 80 ? 1900 + year : 2000 + year;
  return `${fullYear}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
}

/**
 * NMEA センテンスの XOR チェックサムを検証する。
 * `$` 開始でない、または `*XX` を持たない場合は検証対象外として null を返す。
 */
export function checksumIsValid(line: string): boolean | null {
  const star = line.indexOf('*');
  if (!line.startsWith('$') || star < 0 || star + 2 >= line.length) return null;
  let checksum = 0;
  for (let index = 1; index < star; index += 1) checksum ^= line.charCodeAt(index);
  const expected = Number.parseInt(line.slice(star + 1, star + 3), 16);
  return Number.isFinite(expected) ? checksum === expected : false;
}

/**
 * バイト列が NMEA センテンスとして妥当かを判定し、妥当ならデコード済み文字列を返す。
 * 印字可能 ASCII のみで構成され、`$TTTSSS,...*XX` の形をしている必要がある。
 */
export function decodeNmeaSentence(bytes: Uint8Array, decoder: TextDecoder): string | null {
  if (bytes.length < 10 || bytes.length > MAX_NMEA_BYTES) return null;
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) return null;
  }
  const text = decoder.decode(bytes);
  if (!/^\$[A-Z][A-Z0-9]{3,5},.*\*[0-9A-F]{2}$/i.test(text)) return null;
  return text;
}

/** センテンス識別子から talker ID（先頭 2 文字相当）を取り出す */
function extractTalker(sentence: string): string {
  return sentence.length > 3 ? sentence.slice(0, sentence.length - 3) : 'GN';
}

/** NMEA 0183 センテンス 1 行を解析する */
export function parseNmea(line: string): ParsedMessage {
  const update: Partial<Telemetry> = {};
  if (!line.startsWith('$')) return { type: 'RAW', valid: null, update };

  const valid = checksumIsValid(line);
  const star = line.indexOf('*');
  const payload = line.slice(1, star > -1 ? star : undefined);
  const fields = payload.split(',');
  const sentence = fields[0] ?? '';
  const type = sentence.length >= 3 ? sentence.slice(-3) : 'RAW';
  const talker = extractTalker(sentence);

  let gsa: GsaReport | undefined;
  let gsv: GsvReport | undefined;

  switch (type) {
    case 'GGA': {
      update.timeUtc = formatNmeaTime(fields[1]);
      const quality = parseNumber(fields[6]) ?? GGA_QUALITY.NO_FIX;
      update.quality = quality;
      update.satellitesUsed = parseNumber(fields[7]);
      if (quality !== GGA_QUALITY.NO_FIX) {
        update.latitude = parseCoordinate(fields[2], fields[3]);
        update.longitude = parseCoordinate(fields[4], fields[5]);
        update.hdop = parseNumber(fields[8]);
        update.altitude = parseNumber(fields[9]);
        update.geoidSeparation = parseNumber(fields[11]);
      } else {
        clearPositionFields(update);
        // HDOP は GGA 自身が載せている値なので、この電文の責任で消す
        update.hdop = undefined;
      }
      break;
    }
    case 'RMC': {
      if (fields[2] === 'A') {
        update.latitude = parseCoordinate(fields[3], fields[4]);
        update.longitude = parseCoordinate(fields[5], fields[6]);
      }
      const speedKnots = parseNumber(fields[7]);
      update.speedKmh = speedKnots === undefined ? undefined : speedKnots * KNOTS_TO_KMH;
      update.course = parseNumber(fields[8]);
      update.dateUtc = formatNmeaDate(fields[9]);
      update.timeUtc = formatNmeaTime(fields[1]);
      break;
    }
    case 'GSA': {
      update.pdop = parseNumber(fields[15]);
      update.hdop = parseNumber(fields[16]);
      update.vdop = parseNumber(fields[17]);
      // フィールド 3〜14 が測位に使用中の衛星 PRN スロット（最大 12 機）
      const prns: number[] = [];
      for (let index = 3; index <= 14; index += 1) {
        const prn = parseNumber(fields[index]);
        if (prn !== undefined && prn > 0) prns.push(prn);
      }
      gsa = { talker, systemId: parseNumber(fields[18]), prns };
      break;
    }
    case 'GSV': {
      // フィールド 4 以降が [PRN, 仰角, 方位角, C/N0] の 4 つ組の繰り返し
      const prns: number[] = [];
      for (let index = 4; index + 3 < fields.length; index += 4) {
        const prn = parseNumber(fields[index]);
        if (prn !== undefined && prn > 0) prns.push(prn);
      }
      gsv = { talker, prns, totalInView: parseNumber(fields[3]) };
      break;
    }
    case 'GST': {
      const latitudeSigma = parseNumber(fields[6]);
      const longitudeSigma = parseNumber(fields[7]);
      if (latitudeSigma !== undefined && longitudeSigma !== undefined) {
        update.horizontalError = Math.hypot(latitudeSigma, longitudeSigma);
      }
      update.verticalError = parseNumber(fields[8]);
      break;
    }
    case 'VTG': {
      update.course = parseNumber(fields[1]);
      update.speedKmh = parseNumber(fields[7]);
      break;
    }
    case 'ZDA': {
      update.timeUtc = formatNmeaTime(fields[1]);
      if (fields[2] && fields[3] && fields[4]) {
        update.dateUtc = `${fields[4]}-${fields[3].padStart(2, '0')}-${fields[2].padStart(2, '0')}`;
      }
      break;
    }
  }

  // 表示用の要約はフィールドを分解し直さず、ここで組み立てたものを持ち回る
  return { type, valid, update, summary: formatNmeaSummary(type, fields, talker) || undefined, gsa, gsv };
}
