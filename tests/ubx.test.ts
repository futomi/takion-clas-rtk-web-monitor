import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  CFG_KEY_RATE_MEAS,
  buildValgetRequest,
  buildValsetRequest,
  parseUbx,
  readValgetValues,
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

/** 日時が有効な NAV-PVT を、UTC の日時と秒の端数（ns）から組み立てる */
function navPvtAt(date: [number, number, number], time: [number, number, number], nano: number): Uint8Array {
  return buildUbxFrame(0x01, 0x07, navPvtPayload((view) => {
    view.setUint16(4, date[0], true);
    view.setUint8(6, date[1]);
    view.setUint8(7, date[2]);
    view.setUint8(8, time[0]);
    view.setUint8(9, time[1]);
    view.setUint8(10, time[2]);
    view.setUint8(11, 0x03);
    view.setInt32(16, nano, true);
  }));
}

describe('UBX チェックサム', () => {
  it('アプリが組み立てて送るフレームは自己整合している', () => {
    assert.equal(ubxChecksumIsValid(buildValgetRequest([CFG_KEY_MSGOUT_NAV_PVT_USB, CFG_KEY_RATE_MEAS])), true);
    assert.equal(ubxChecksumIsValid(buildValsetRequest([{ key: CFG_KEY_RATE_MEAS, value: 200 }])), true);
  });
  it('1 バイト壊すと検出できる', () => {
    const broken = buildValgetRequest([CFG_KEY_MSGOUT_NAV_PVT_USB]);
    broken[7] ^= 0xff;
    assert.equal(ubxChecksumIsValid(broken), false);
  });
});

describe('UBX 設定フレームの組み立て', () => {
  // 受信機で動作を確かめてあるフレーム。組み立て方を変えてもこのバイト列から外れないこと
  it('NAV-PVT 出力レートの照会は、実機で確かめたフレームと一致する', () => {
    assert.deepEqual(buildValgetRequest([CFG_KEY_MSGOUT_NAV_PVT_USB]), new Uint8Array([
      0xb5, 0x62, 0x06, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x53, 0xf7,
    ]));
  });

  it('NAV-PVT 出力の有効化・無効化は、実機で確かめたフレームと一致する', () => {
    assert.deepEqual(buildValsetRequest([{ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 1 }]), new Uint8Array([
      0xb5, 0x62, 0x06, 0x8a, 0x09, 0x00, 0x00, 0x01, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x01, 0x55, 0x52,
    ]));
    assert.deepEqual(buildValsetRequest([{ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 0 }]), new Uint8Array([
      0xb5, 0x62, 0x06, 0x8a, 0x09, 0x00, 0x00, 0x01, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x00, 0x54, 0x51,
    ]));
  });

  it('測位間隔はキーの大きさ（2 バイト）に従ってリトルエンディアンで書く', () => {
    const frame = buildValsetRequest([{ key: CFG_KEY_RATE_MEAS, value: 200 }]);
    // ヘッダ 6 + version・層・予約 4 + キー 4 + 値 2 + チェックサム 2
    assert.equal(frame.length, 18);
    assert.deepEqual(Array.from(frame.subarray(6, 16)), [
      0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x21, 0x30, 0xc8, 0x00,
    ]);
  });

  it('複数の項目を 1 フレームへ並べる', () => {
    const frame = buildValsetRequest([
      { key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 0 },
      { key: CFG_KEY_RATE_MEAS, value: 1000 },
    ]);
    assert.equal(frame[4], 4 + (4 + 1) + (4 + 2));
    assert.deepEqual(Array.from(frame.subarray(10, 21)), [
      0x09, 0x00, 0x91, 0x20, 0x00,
      0x01, 0x00, 0x21, 0x30, 0xe8, 0x03,
    ]);
  });

  it('値の大きさが分からないキーは組み立てを拒む', () => {
    assert.throws(() => buildValsetRequest([{ key: 0x00000001, value: 1 }]));
  });
});

describe('readValgetValues', () => {
  it('大きさの違う値が並んでいても、キーごとに読み分ける', () => {
    const payload = [
      0x01, 0x00, 0x00, 0x00,
      0x09, 0x00, 0x91, 0x20, 0x00, // NAV-PVT 出力レート = 0（1 バイト）
      0x01, 0x00, 0x21, 0x30, 0xe8, 0x03, // 測位間隔 = 1000 ms（2 バイト）
    ];
    const values = readValgetValues(buildUbxFrame(0x06, 0x8b, payload));
    assert.deepEqual(values, new Map([[CFG_KEY_MSGOUT_NAV_PVT_USB, 0], [CFG_KEY_RATE_MEAS, 1000]]));
  });

  it('値が途中で切れていれば、そこまでで打ち切る', () => {
    const payload = [0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x21, 0x30, 0xe8];
    assert.deepEqual(readValgetValues(buildUbxFrame(0x06, 0x8b, payload)), new Map());
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
    assert.equal(withValid.update.timeUtc, '09:07:01.00');
  });

  it('時刻は秒の端数を 1/100 秒に丸めて NMEA と同じ桁で持つ', () => {
    // 5 Hz の 2 つめのエポック。端数には数百 ns のずれが乗る
    assert.equal(parseUbx(navPvtAt([2024, 3, 5], [9, 7, 1], 200_000_321)).update.timeUtc, '09:07:01.20');
    assert.equal(parseUbx(navPvtAt([2024, 3, 5], [9, 7, 1], 799_999_512)).update.timeUtc, '09:07:01.80');
  });

  it('負の端数は前の秒へ繰り下げる', () => {
    // 56 秒 - 0.8 秒 = 55.2 秒
    assert.equal(parseUbx(navPvtAt([2024, 3, 5], [9, 7, 56], -800_000_000)).update.timeUtc, '09:07:55.20');
  });

  it('丸めで繰り上がった秒は、分・時・日付まで送る', () => {
    const parsed = parseUbx(navPvtAt([2024, 12, 31], [23, 59, 59], 999_999_000));
    assert.equal(parsed.update.dateUtc, '2025-01-01');
    assert.equal(parsed.update.timeUtc, '00:00:00.00');
  });

  it('チェックサム不正なら解析を打ち切る', () => {
    const frame = buildUbxFrame(0x01, 0x07, new Uint8Array(92));
    frame[frame.length - 1] ^= 0xff;
    const parsed = parseUbx(frame);
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.update, {});
  });
});

describe('ペイロード長の整合検査', () => {
  it('名乗る長さがフレーム長と合わないものは解析しない', () => {
    // 長さ表記を信じて DataView を張るため、辻褄が合わないと範囲外で例外になる。
    // 受信ループの中で投げると読み取りごと止まってしまう
    const frame = buildUbxFrame(0x01, 0x07, new Array(92).fill(0));
    // 長さフィールドだけを 92 → 4096 に書き換え、チェックサムも整合させる
    frame[4] = 0x00;
    frame[5] = 0x10;
    let a = 0;
    let b = 0;
    for (let i = 2; i < frame.length - 2; i += 1) {
      a = (a + frame[i]) & 0xff;
      b = (b + a) & 0xff;
    }
    frame[frame.length - 2] = a;
    frame[frame.length - 1] = b;

    assert.ok(ubxChecksumIsValid(frame), 'チェックサム自体は通る前提のケース');
    const parsed = parseUbx(frame);
    assert.equal(parsed.type, 'PVT');
    assert.deepEqual(parsed.update, {}, '解析へ進まず、例外も投げない');
  });
});
