import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanFrames, trimStaleBuffer } from '../app/lib/frameScanner.ts';
import { buildRtcmFrame, buildUbxFrame } from './helpers.ts';

const decoder = new TextDecoder('ascii');
const encoder = new TextEncoder();
const NMEA_LINE = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47\r\n';
const nmeaBytes = encoder.encode(NMEA_LINE);

const concat = (...chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

describe('scanFrames', () => {
  it('混在ストリームから 3 プロトコルすべてを受信順に切り出す', () => {
    const ubx = buildUbxFrame(0x01, 0x07, new Uint8Array(92));
    const rtcm = buildRtcmFrame([0x3e, 0xd0, 0x00, 0x03]);
    const buffer = concat(nmeaBytes, ubx, rtcm);

    const { frames, consumed } = scanFrames(buffer, decoder);
    assert.equal(consumed, buffer.length);
    assert.deepEqual(frames.map((f) => f.kind), ['nmea', 'ubx', 'rtcm']);
    assert.equal(frames[0].kind === 'nmea' && frames[0].text, NMEA_LINE.trim());
  });

  it('途中で切れたフレームは消費せず次チャンクへ持ち越す', () => {
    const ubx = buildUbxFrame(0x01, 0x07, new Uint8Array(92));
    const first = concat(nmeaBytes, ubx.slice(0, 20));

    const head = scanFrames(first, decoder);
    assert.deepEqual(head.frames.map((f) => f.kind), ['nmea']);
    assert.equal(head.consumed, nmeaBytes.length);

    const rest = concat(first.slice(head.consumed), ubx.slice(20));
    const tail = scanFrames(rest, decoder);
    assert.deepEqual(tail.frames.map((f) => f.kind), ['ubx']);
    assert.equal(tail.consumed, rest.length);
  });

  it('NMEA が改行前で切れている場合は次チャンクを待つ', () => {
    const partial = encoder.encode('$GPGGA,123519,4807.038,N,0113');
    const { frames, consumed } = scanFrames(partial, decoder);
    assert.equal(frames.length, 0);
    assert.equal(consumed, 0);
  });

  it('先頭のノイズや偽の同期バイトを読み飛ばして再同期する', () => {
    const buffer = concat(new Uint8Array([0x00, 0xff, 0xb5, 0x99, 0xd3, 0xfc]), nmeaBytes);
    const { frames } = scanFrames(buffer, decoder);
    assert.deepEqual(frames.map((f) => f.kind), ['nmea']);
  });

  it('チェックサムが壊れた UBX は破棄して後続を読む', () => {
    const broken = buildUbxFrame(0x01, 0x07, new Uint8Array(92));
    broken[broken.length - 1] ^= 0xff;
    const { frames } = scanFrames(concat(broken, nmeaBytes), decoder);
    assert.deepEqual(frames.map((f) => f.kind), ['nmea']);
  });

  it('CRC が壊れた RTCM は破棄して後続を読む', () => {
    const broken = buildRtcmFrame([0x3e, 0xd0, 0x00, 0x03]);
    broken[broken.length - 2] ^= 0xff;
    const { frames } = scanFrames(concat(broken, nmeaBytes), decoder);
    assert.deepEqual(frames.map((f) => f.kind), ['nmea']);
  });

  it('過大なペイロード長を主張する UBX ヘッダを信用しない', () => {
    const bogus = new Uint8Array([0xb5, 0x62, 0x01, 0x07, 0xff, 0xff]);
    const { frames } = scanFrames(concat(bogus, nmeaBytes), decoder);
    assert.deepEqual(frames.map((f) => f.kind), ['nmea']);
  });

  it('チェックサムが壊れた NMEA も 1 行として取り出す（検証結果は解析側が持つ）', () => {
    const bad = encoder.encode('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*99\r\n');
    const { frames } = scanFrames(bad, decoder);
    assert.equal(frames.length, 1);
  });

  it('複数の NMEA 行を連続して切り出す', () => {
    const { frames, consumed } = scanFrames(concat(nmeaBytes, nmeaBytes, nmeaBytes), decoder);
    assert.equal(frames.length, 3);
    assert.equal(consumed, nmeaBytes.length * 3);
  });
});

describe('trimStaleBuffer', () => {
  it('通常サイズのバッファはそのまま返す', () => {
    assert.equal(trimStaleBuffer(new Uint8Array(100)).length, 100);
  });
  it('理論上の最大フレーム長を超えたら末尾だけ残す', () => {
    assert.equal(trimStaleBuffer(new Uint8Array(20000)).length, 16);
  });
});
