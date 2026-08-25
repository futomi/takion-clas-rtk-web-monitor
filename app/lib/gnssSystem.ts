/**
 * 衛星システム（GPS / みちびき / Galileo …）の識別と表記。
 *
 * NMEA は talker ID・System ID・PRN 番号帯という 3 通りの手掛かりで系統を示すため、
 * 判定ロジックをここへ集約し、表記も 1 つの辞書から引く。
 */

export type GnssSystemKey = 'gps' | 'qzss' | 'galileo' | 'glonass' | 'beidou' | 'sbas' | 'other';

export type GnssSystemInfo = {
  key: GnssSystemKey;
  /** 画面に出す日本語表記 */
  nameJa: string;
  /** バッジ用の 3 文字表記 */
  short: string;
};

export type SatelliteBreakdown = Partial<Record<GnssSystemKey, number>>;

export const GNSS_SYSTEMS: Record<GnssSystemKey, GnssSystemInfo> = {
  gps: { key: 'gps', nameJa: 'GPS', short: 'GPS' },
  qzss: { key: 'qzss', nameJa: 'みちびき', short: 'QZS' },
  galileo: { key: 'galileo', nameJa: 'Galileo', short: 'GAL' },
  glonass: { key: 'glonass', nameJa: 'GLONASS', short: 'GLO' },
  beidou: { key: 'beidou', nameJa: 'BeiDou', short: 'BDS' },
  sbas: { key: 'sbas', nameJa: 'SBAS', short: 'SBA' },
  other: { key: 'other', nameJa: 'その他', short: 'OTH' },
};

export const GNSS_SYSTEM_ORDER: GnssSystemKey[] = ['gps', 'qzss', 'galileo', 'glonass', 'beidou', 'sbas', 'other'];

/**
 * Talker ID から衛星システムを特定
 */
export function getGnssSystemFromTalker(talker: string): GnssSystemKey {
  const t = talker.toUpperCase();
  if (t === 'GP') return 'gps';
  if (t === 'GQ' || t === 'QZ') return 'qzss';
  if (t === 'GA') return 'galileo';
  if (t === 'GL') return 'glonass';
  if (t === 'GB' || t === 'BD') return 'beidou';
  if (t === 'GI') return 'other';
  if (t === 'SB') return 'sbas';
  return 'other';
}

/**
 * NMEA 4.10+ の System ID (1-6) から衛星システムを特定
 */
function getGnssSystemFromSystemId(systemId: number | string | undefined): GnssSystemKey | null {
  if (!systemId) return null;
  const id = Number(systemId);
  switch (id) {
    case 1: return 'gps';
    case 2: return 'glonass';
    case 3: return 'galileo';
    case 4: return 'beidou';
    case 5: return 'qzss';
    case 6: return 'other';
    default: return null;
  }
}

/**
 * PRN 番号と Talker / System ID から衛星システムを特定
 */
export function identifyGnssSystem(prn: number, talker?: string, systemId?: number | string): GnssSystemKey {
  const bySysId = getGnssSystemFromSystemId(systemId);
  if (bySysId) return bySysId;

  if (talker && talker !== 'GN') {
    return getGnssSystemFromTalker(talker);
  }

  if (prn >= 193 && prn <= 202) return 'qzss';
  if (prn >= 65 && prn <= 96) return 'glonass';
  if (prn >= 301 && prn <= 336) return 'galileo';
  if (prn >= 401 && prn <= 463) return 'beidou';
  if ((prn >= 33 && prn <= 64) || (prn >= 120 && prn <= 158)) return 'sbas';
  if (prn >= 1 && prn <= 32) return 'gps';

  return 'other';
}
