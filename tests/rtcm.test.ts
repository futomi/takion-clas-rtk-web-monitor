import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRtcm, readRtcmMessageType, readRtcmPayloadLength } from '../app/lib/rtcm.ts';
import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  parseUbx,
  readAckTarget,
  readUbxPayloadLength,
  readValgetByte,
} from '../app/lib/ubx.ts';
import { buildRtcmFrame, buildUbxFrame } from './helpers.ts';

describe('RTCM3', () => {
  it('CRC-24Q が自己整合するフレームを受理し種別を読む', () => {
    const frame = buildRtcmFrame([0x3e, 0xd0, 0x00, 0x03]);
    const parsed = parseRtcm(frame);
    assert.equal(parsed.valid, true);
    assert.equal(readRtcmMessageType(frame), 1005);
    assert.equal(parsed.type, 'RTCM1005');
    assert.match(parsed.summary!, /type 1005/);
  });

  it('CRC が壊れていれば拒否する', () => {
    const frame = buildRtcmFrame([0x3e, 0xd0, 0x00, 0x03]);
    frame[frame.length - 1] ^= 0xff;
    assert.equal(parseRtcm(frame).valid, false);
  });

  it('ペイロード長を 10bit で読む', () => {
    assert.equal(readRtcmPayloadLength(buildRtcmFrame(new Uint8Array(600))), 600);
  });

  it('種別が読めないフレームは RTCM3 として扱う', () => {
    assert.equal(parseRtcm(buildRtcmFrame([0x00, 0x00])).type, 'RTCM3');
  });
});

describe('UBX 設定応答の読み取り', () => {
  it('CFG-VALGET から対象キーの値を取り出す', () => {
    const view = new DataView(new ArrayBuffer(9));
    view.setUint32(4, CFG_KEY_MSGOUT_NAV_PVT_USB, true);
    view.setUint8(8, 0);
    const frame = buildUbxFrame(0x06, 0x8b, new Uint8Array(view.buffer));
    assert.equal(readValgetByte(frame, CFG_KEY_MSGOUT_NAV_PVT_USB), 0);
    assert.equal(readValgetByte(frame, 0x12345678), null);
  });

  it('CFG-VALGET 以外には反応しない', () => {
    assert.equal(readValgetByte(buildUbxFrame(0x01, 0x07, new Uint8Array(92)), CFG_KEY_MSGOUT_NAV_PVT_USB), null);
  });

  it('ACK-ACK / ACK-NAK の対象コマンドを判別する', () => {
    assert.deepEqual(readAckTarget(buildUbxFrame(0x05, 0x01, [0x06, 0x8b])), {
      accepted: true,
      targetClass: 0x06,
      targetId: 0x8b,
    });
    assert.equal(readAckTarget(buildUbxFrame(0x05, 0x00, [0x06, 0x8a]))?.accepted, false);
    assert.equal(readAckTarget(buildUbxFrame(0x01, 0x07, [0, 0])), null);
  });

  it('ACK 系はテレメトリを更新せず要約だけを返す', () => {
    const parsed = parseUbx(buildUbxFrame(0x05, 0x01, [0x06, 0x8b]));
    assert.equal(parsed.type, 'ACK-ACK');
    assert.deepEqual(parsed.update, {});
    assert.match(parsed.summary!, /command 06\/8B/);
  });

  it('ペイロード長をリトルエンディアンで読む', () => {
    assert.equal(readUbxPayloadLength(buildUbxFrame(0x01, 0x07, new Uint8Array(300))), 300);
  });
});
