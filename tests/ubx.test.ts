import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISABLE_NAV_PVT_USB_RAM,
  ENABLE_NAV_PVT_USB_RAM,
  GET_NAV_PVT_USB_RATE,
  parseUbx,
  ubxChecksumIsValid,
  ubxMessageType,
} from '../app/lib/ubx.ts';
import { buildUbxFrame } from './helpers.ts';

/** 92 バイトの NAV-PVT ペイロードを DataView で組み立てる */
function navPvtPayload(fill: (view: DataView) => void): Uint8Array {
  const view = new DataView(new ArrayBuffer(92));
  fill(view);
  return new Uint8Array(view.buffer);
}

describe('UBX チェックサム', () => {
  it('アプリが送信する定数フレームは自己整合している', () => {
    assert.equal(ubxChecksumIsValid(GET_NAV_PVT_USB_RATE), true);
    assert.equal(ubxChecksumIsValid(ENABLE_NAV_PVT_USB_RAM), true);
    assert.equal(ubxChecksumIsValid(DISABLE_NAV_PVT_USB_RAM), true);
  });
  it('1 バイト壊すと検出できる', () => {
    const broken = Uint8Array.from(GET_NAV_PVT_USB_RATE);
    broken[7] ^= 0xff;
    assert.equal(ubxChecksumIsValid(broken), false);
  });
});

describe('ubxMessageType', () => {
  it('既知のクラス/ID を辞書キーへ対応付ける', () => {
    assert.equal(ubxMessageType(0x01, 0x07), 'PVT');
    assert.equal(ubxMessageType(0x01, 0x03), 'STATUS');
    assert.equal(ubxMessageType(0x01, 0x43), 'SIG');
    assert.equal(ubxMessageType(0x02, 0x73), 'QZSSL6');
    assert.equal(ubxMessageType(0x05, 0x01), 'ACK-ACK');
    assert.equal(ubxMessageType(0x05, 0x00), 'ACK-NAK');
    assert.equal(ubxMessageType(0x06, 0x8b), 'CFG-VALGET');
  });
  it('未知の組は 16 進表記へフォールバックする', () => {
    assert.equal(ubxMessageType(0x0a, 0x36), '0A/36');
  });
});

describe('parseUbx / NAV-PVT', () => {
  it('搬送波解が Fix なら quality=4 として座標を取り出す', () => {
    const payload = navPvtPayload((view) => {
      view.setUint8(20, 3); // fixType = 3D
      view.setUint8(21, 0b1000_0001); // gnssFixOK + carrierSolution=2 (Fix)
      view.setUint8(23, 21); // numSV
      view.setInt32(24, Math.round(139.7 * 1e7), true);
      view.setInt32(28, Math.round(35.6 * 1e7), true);
      view.setInt32(32, 79_000, true); // 楕円体高 79m
      view.setInt32(36, 40_000, true); // 標高 40m
    });
    const parsed = parseUbx(buildUbxFrame(0x01, 0x07, payload));
    assert.equal(parsed.type, 'PVT');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.update.quality, 4);
    assert.equal(parsed.update.satellitesUsed, 21);
    assert.ok(Math.abs(parsed.update.longitude! - 139.7) < 1e-6);
    assert.ok(Math.abs(parsed.update.latitude! - 35.6) < 1e-6);
    assert.ok(Math.abs(parsed.update.altitude! - 40) < 1e-9);
    assert.ok(Math.abs(parsed.update.geoidSeparation! - 39) < 1e-9);
  });

  it('搬送波解が Float なら quality=5 になる', () => {
    const payload = navPvtPayload((view) => {
      view.setUint8(20, 3);
      view.setUint8(21, 0b0100_0001); // carrierSolution=1 (Float)
    });
    assert.equal(parseUbx(buildUbxFrame(0x01, 0x07, payload)).update.quality, 5);
  });

  it('未測位なら位置系フィールドを明示的に無効化する', () => {
    const parsed = parseUbx(buildUbxFrame(0x01, 0x07, new Uint8Array(92)));
    assert.equal(parsed.update.quality, 0);
    assert.ok('latitude' in parsed.update);
    assert.equal(parsed.update.latitude, undefined);
    assert.equal(parsed.update.pdop, undefined);
  });

  it('推定精度のセンチネル値を undefined に落とす', () => {
    const payload = navPvtPayload((view) => {
      view.setUint8(20, 3);
      view.setUint8(21, 0b0000_0001);
      view.setUint32(40, 0xffffffff, true);
      view.setUint32(44, 0xffffffff, true);
      view.setUint16(76, 0xffff, true);
    });
    const parsed = parseUbx(buildUbxFrame(0x01, 0x07, payload));
    assert.equal(parsed.update.horizontalError, undefined);
    assert.equal(parsed.update.verticalError, undefined);
    assert.equal(parsed.update.pdop, undefined);
  });

  it('日時は validDate/validTime が両方立っている場合のみ採用する', () => {
    const withoutValid = parseUbx(buildUbxFrame(0x01, 0x07, navPvtPayload((view) => {
      view.setUint16(4, 2024, true);
      view.setUint8(11, 0x01); // validDate のみ
    })));
    assert.equal(withoutValid.update.dateUtc, undefined);

    const withValid = parseUbx(buildUbxFrame(0x01, 0x07, navPvtPayload((view) => {
      view.setUint16(4, 2024, true);
      view.setUint8(6, 3);
      view.setUint8(7, 5);
      view.setUint8(8, 9);
      view.setUint8(9, 7);
      view.setUint8(10, 1);
      view.setUint8(11, 0x03);
    })));
    assert.equal(withValid.update.dateUtc, '2024-03-05');
    assert.equal(withValid.update.timeUtc, '09:07:01');
  });

  it('チェックサム不正なら解析を打ち切る', () => {
    const frame = buildUbxFrame(0x01, 0x07, new Uint8Array(92));
    frame[frame.length - 1] ^= 0xff;
    const parsed = parseUbx(frame);
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.update, {});
  });
});
