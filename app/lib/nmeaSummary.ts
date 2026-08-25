import { GGA_QUALITY, KNOTS_TO_KMH } from './constants';
import { GNSS_SYSTEMS, getGnssSystemFromTalker } from './gnssSystem';

/**
 * NMEA センテンスの分解済みフィールドから、人間が読める 1 行要約を作る。
 *
 * 解析（{@link ./nmea}）は値を取り出すのが仕事で、こちらは表示文言の組み立てが仕事。
 * ただしフィールド位置の知識を二重に持たないよう、生文字列の再分解はせず
 * `parseNmea` が分解した結果をそのまま受け取る。ログ行の `meaning` 欄にだけ使う。
 */

/** NMEA の GGA が示す測位品質コードの日本語表記 */
const GGA_QUALITY_TEXT: Record<number, string> = {
  [GGA_QUALITY.STANDALONE]: '単独測位',
  [GGA_QUALITY.DGPS]: 'DGPS',
  [GGA_QUALITY.PRECISE_FIX]: '高精度Fix',
  [GGA_QUALITY.PRECISE_FLOAT]: '高精度Float',
};

/** ピリオド区切りで連結する。空の項目は落とす */
const joinParts = (parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

/**
 * 数値らしき文字列を固定小数に整形する。数値でなければ undefined。
 * `scale` を与えると単位換算（ノット → km/h など）を挟める。
 */
function formatFixed(
  value: string | undefined,
  digits: number,
  prefix = '',
  suffix = '',
  scale = 1,
): string | undefined {
  if (!value) return undefined;
  const parsed = Number(value) * scale;
  return Number.isFinite(parsed) ? `${prefix}${parsed.toFixed(digits)}${suffix}` : undefined;
}

/**
 * 分解済みフィールドから、人間が直感的に読める日本語の要約テキストを生成する。
 *
 * @param type 電文種別（'GGA' など）
 * @param fields `$` とチェックサムを除いた本文をカンマ分解したもの。添字は NMEA の仕様どおり
 * @param talker 電文の talker ID（'GP' / 'GQ' など）
 */
export function formatNmeaSummary(type: string, fields: string[], talker: string): string {
  switch (type) {
    case 'GGA':
      return joinParts([
        GGA_QUALITY_TEXT[Number(fields[6])] ?? '未測位',
        fields[7] ? `${fields[7]}機` : undefined,
        fields[8] ? `HDOP ${fields[8]}` : undefined,
        fields[9] ? `標高 ${fields[9]}m` : undefined,
      ]);
    case 'RMC':
      return joinParts([
        `状態: ${fields[2] === 'A' ? '有効' : '無効'}`,
        formatFixed(fields[7], 1, '', ' km/h', KNOTS_TO_KMH),
        formatFixed(fields[8], 1, '方位 ', '°'),
      ]);
    case 'GSA': {
      const mode = fields[2] === '3' ? '3D測位' : fields[2] === '2' ? '2D測位' : '未測位';
      return joinParts([`モード: ${mode}`, fields[15] ? `PDOP ${fields[15]}` : undefined]);
    }
    case 'GSV': {
      // 系統名は GNSS_SYSTEMS の表記に統一する
      const system = getGnssSystemFromTalker(talker);
      const systemName = system === 'other' ? 'GNSS' : GNSS_SYSTEMS[system].nameJa;
      const totalSvs = fields[3] ? `可視 ${fields[3]}機` : '';
      const pageNumber = fields[2] && fields[1] ? `(${fields[2]}/${fields[1]})` : '';
      return `${systemName} ${totalSvs} ${pageNumber}`.replace(/\s+/g, ' ').trim();
    }
    case 'GST':
      return joinParts([
        formatFixed(fields[6], 3, '緯度±', 'm'),
        formatFixed(fields[7], 3, '経度±', 'm'),
        formatFixed(fields[8], 3, '高度±', 'm'),
      ]);
    case 'VTG':
      return joinParts([
        fields[1] ? `進行方位 ${fields[1]}°` : undefined,
        fields[7] ? `${fields[7]} km/h` : undefined,
      ]);
    case 'ZDA': {
      const time = fields[1] ? `${fields[1].slice(0, 2)}:${fields[1].slice(2, 4)}:${fields[1].slice(4, 6)} UTC` : '';
      const date = fields[4] && fields[3] && fields[2] ? `${fields[4]}-${fields[3]}-${fields[2]}` : '';
      return [date, time].filter(Boolean).join(' ');
    }
    default:
      return '';
  }
}
