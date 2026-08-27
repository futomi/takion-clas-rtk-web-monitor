import { MAX_NMEA_BYTES, MAX_UBX_PAYLOAD_BYTES } from './constants';
import { decodeNmeaSentence } from './nmea';
import { RTCM_FRAME_OVERHEAD, RTCM_PREAMBLE, readRtcmPayloadLength, rtcmChecksumIsValid } from './rtcm';
import { UBX_FRAME_OVERHEAD, isKnownUbxClass, readUbxPayloadLength, ubxChecksumIsValid } from './ubx';

/** NMEA センテンス開始バイト `$` */
const NMEA_START = 0x24;
/** UBX 同期バイト */
const UBX_SYNC_1 = 0xb5;
const UBX_SYNC_2 = 0x62;

/**
 * 走査で切り出された 1 フレーム。
 *
 * バイナリの 2 種別が持つ `valid` は、走査中に済ませたチェックサム検証の結果。
 * 走査はチェックサムが通ったフレームしか切り出さないため常に `true` だが、
 * 解析側が同じ計算を繰り返さずに済むよう、確定した事実として持ち回る。
 */
export type ScannedFrame =
  | { kind: 'nmea'; text: string }
  | { kind: 'ubx'; frame: Uint8Array; valid: boolean }
  | { kind: 'rtcm'; frame: Uint8Array; valid: boolean };

export type ScanResult = {
  /** 切り出せたフレーム（受信順） */
  frames: ScannedFrame[];
  /** 消費したバイト数。呼び出し側はこの位置までを捨てて残りを次回に持ち越す */
  consumed: number;
};

/**
 * NMEA / UBX / RTCM3 が混在するバイト列から、完成しているフレームだけを切り出す。
 *
 * フレームが途中で切れている場合はそこで走査を打ち切り、`consumed` をその手前に留める。
 * 呼び出し側が残りを次のチャンクと連結して再度渡すことで、境界をまたぐフレームも復元できる。
 * 同期外れ（チェックサム不一致や不正な長さ）の場合は 1 バイトずつずらして再同期を試みる。
 * フレームの完成を待つ前に、ヘッダだけで偽物と分かる同期（未定義の UBX クラス、
 * RTCM の予約ビット）はその場で読み飛ばす。偽の同期 1 つで後続の正常な電文が
 * まとめて足止めされるのを避けるため。
 *
 * 判定にはチェックサム検証だけを使い、電文の中身は解析しない。解析は呼び出し側が
 * 切り出されたフレームに対して一度だけ行う。
 */
export function scanFrames(buffer: Uint8Array, decoder: TextDecoder): ScanResult {
  const frames: ScannedFrame[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];

    if (byte === UBX_SYNC_1) {
      if (buffer.length - cursor < 2) break;
      if (buffer[cursor + 1] !== UBX_SYNC_2) {
        cursor += 1;
        continue;
      }
      if (buffer.length - cursor < 3) break;
      // 存在しないクラスなら偶然同期バイトが並んだだけ。長さ表記を信じて待たない
      if (!isKnownUbxClass(buffer[cursor + 2])) {
        cursor += 1;
        continue;
      }
      if (buffer.length - cursor < UBX_FRAME_OVERHEAD - 2) break;
      const payloadLength = readUbxPayloadLength(buffer, cursor);
      if (payloadLength > MAX_UBX_PAYLOAD_BYTES) {
        cursor += 1;
        continue;
      }
      const frameLength = payloadLength + UBX_FRAME_OVERHEAD;
      if (buffer.length - cursor < frameLength) break;
      const frame = buffer.slice(cursor, cursor + frameLength);
      if (!ubxChecksumIsValid(frame)) {
        cursor += 1;
        continue;
      }
      frames.push({ kind: 'ubx', frame, valid: true });
      cursor += frameLength;
      continue;
    }

    if (byte === NMEA_START) {
      let lineEnd = cursor + 1;
      const searchEnd = Math.min(buffer.length, cursor + MAX_NMEA_BYTES + 1);
      while (lineEnd < searchEnd && buffer[lineEnd] !== 0x0a && buffer[lineEnd] !== 0x0d) lineEnd += 1;
      if (lineEnd >= searchEnd) {
        // 上限まで見て終端が無い場合、まだ伸びる余地があるなら次チャンクを待つ
        if (buffer.length - cursor <= MAX_NMEA_BYTES) break;
        cursor += 1;
        continue;
      }
      const sentence = decodeNmeaSentence(buffer.slice(cursor, lineEnd), decoder);
      if (!sentence) {
        cursor += 1;
        continue;
      }
      frames.push({ kind: 'nmea', text: sentence });
      while (lineEnd < buffer.length && (buffer[lineEnd] === 0x0a || buffer[lineEnd] === 0x0d)) lineEnd += 1;
      cursor = lineEnd;
      continue;
    }

    if (byte === RTCM_PREAMBLE) {
      if (buffer.length - cursor < 3) break;
      // 長さフィールドの上位 6bit は予約領域で常に 0
      if ((buffer[cursor + 1] & 0xfc) !== 0) {
        cursor += 1;
        continue;
      }
      const payloadLength = readRtcmPayloadLength(buffer, cursor);
      const frameLength = payloadLength + RTCM_FRAME_OVERHEAD;
      if (buffer.length - cursor < frameLength) break;
      const frame = buffer.slice(cursor, cursor + frameLength);
      if (!rtcmChecksumIsValid(frame)) {
        cursor += 1;
        continue;
      }
      frames.push({ kind: 'rtcm', frame, valid: true });
      cursor += frameLength;
      continue;
    }

    cursor += 1;
  }

  return { frames, consumed: cursor };
}

/**
 * 未消費バッファが理論上の最大フレーム長を超えて溜まった場合に切り詰める。
 *
 * 破損した長さフィールドを信じて延々と待ち続ける事態を防ぐための安全弁で、
 * 直近の数バイトだけを残して再同期させる。
 */
export function trimStaleBuffer(pending: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const limit = MAX_UBX_PAYLOAD_BYTES + UBX_FRAME_OVERHEAD;
  return pending.length > limit ? pending.slice(-16) : pending;
}
