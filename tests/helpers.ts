import { crc24q } from '../app/lib/rtcm.ts';

/** クラス・ID・ペイロードから正しいチェックサム付き UBX フレームを組み立てる */
export function buildUbxFrame(messageClass: number, messageId: number, payload: ArrayLike<number>): Uint8Array {
  const frame = new Uint8Array(payload.length + 8);
  frame.set([0xb5, 0x62, messageClass, messageId, payload.length & 0xff, (payload.length >> 8) & 0xff]);
  frame.set(Array.from(payload), 6);
  let a = 0;
  let b = 0;
  for (let i = 2; i < frame.length - 2; i += 1) {
    a = (a + frame[i]) & 0xff;
    b = (b + a) & 0xff;
  }
  frame[frame.length - 2] = a;
  frame[frame.length - 1] = b;
  return frame;
}

/** ペイロードから正しい CRC-24Q 付き RTCM3 フレームを組み立てる */
export function buildRtcmFrame(payload: ArrayLike<number>): Uint8Array {
  const frame = new Uint8Array(payload.length + 6);
  frame[0] = 0xd3;
  frame[1] = (payload.length >> 8) & 0x03;
  frame[2] = payload.length & 0xff;
  frame.set(Array.from(payload), 3);
  const crc = crc24q(frame, frame.length - 3);
  frame[frame.length - 3] = (crc >> 16) & 0xff;
  frame[frame.length - 2] = (crc >> 8) & 0xff;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

/** NMEA センテンス本体に正しい XOR チェックサムを付与する */
export function withChecksum(body: string): string {
  let checksum = 0;
  for (let i = 1; i < body.length; i += 1) checksum ^= body.charCodeAt(i);
  return `${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}
