import type { ParsedMessage } from './types';

/** RTCM3 フレームの固定長オーバーヘッド（プリアンブル 1 + 長さ 2 + CRC 3） */
export const RTCM_FRAME_OVERHEAD = 6;
/** RTCM3 フレームのプリアンブル */
export const RTCM_PREAMBLE = 0xd3;
/** CRC-24Q の生成多項式 */
const CRC24Q_POLYNOMIAL = 0x1864cfb;

/** RTCM3 が採用する CRC-24Q を先頭 `end` バイトに対して計算する */
export function crc24q(bytes: Uint8Array, end: number): number {
  let crc = 0;
  for (let index = 0; index < end; index += 1) {
    crc ^= bytes[index] << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if ((crc & 0x1000000) !== 0) crc ^= CRC24Q_POLYNOMIAL;
    }
  }
  return crc & 0xffffff;
}

/** フレームヘッダからペイロード長（10bit）を読む */
export function readRtcmPayloadLength(bytes: Uint8Array, offset = 0): number {
  return ((bytes[offset + 1] & 0x03) << 8) | bytes[offset + 2];
}

/** ペイロード先頭 12bit のメッセージ種別番号を読む */
export function readRtcmMessageType(frame: Uint8Array): number {
  return frame.length >= 5 ? (frame[3] << 4) | (frame[4] >> 4) : 0;
}

/**
 * 末尾 3 バイトの CRC-24Q を検証する。
 *
 * フレーム走査（同期確認）と本解析の両方から呼ばれる。走査側が解析まで走らせずに
 * 済むよう、検証だけを切り出してある。
 */
export function rtcmChecksumIsValid(frame: Uint8Array): boolean {
  const expected = (frame[frame.length - 3] << 16) | (frame[frame.length - 2] << 8) | frame[frame.length - 1];
  return crc24q(frame, frame.length - 3) === expected;
}

/**
 * RTCM3 フレーム 1 件を解析する。
 *
 * @param verifiedChecksum 検証済みなら、その結果。フレーム走査で済ませた検証を
 *   受け取り、同じ CRC-24Q をフレームごとに二度走らせないためのもの。
 *   省略した場合はこの場で検証するので、単体でもそのまま呼べる。
 */
export function parseRtcm(frame: Uint8Array, verifiedChecksum?: boolean): ParsedMessage {
  const valid = verifiedChecksum ?? rtcmChecksumIsValid(frame);
  const messageType = readRtcmMessageType(frame);
  const type = messageType > 0 ? `RTCM${messageType}` : 'RTCM3';
  return {
    type,
    valid,
    update: {},
    summary: `RTCM3 type ${messageType || 'unknown'} · ${frame.length - RTCM_FRAME_OVERHEAD} byte payload`,
  };
}
