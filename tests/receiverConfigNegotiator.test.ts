import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReceiverConfigNegotiator } from '../app/lib/receiverConfigNegotiator.ts';
import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  CFG_KEY_RATE_MEAS,
  UBX_CLASS,
  UBX_ID,
  buildValgetRequest,
  buildValsetRequest,
} from '../app/lib/ubx.ts';
import { buildUbxFrame } from './helpers.ts';

const QUERY = buildValgetRequest([CFG_KEY_MSGOUT_NAV_PVT_USB, CFG_KEY_RATE_MEAS]);
const ENABLE_PVT = buildValsetRequest([{ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 1 }]);
const DISABLE_PVT = buildValsetRequest([{ key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 0 }]);
const setPeriod = (periodMs: number) => buildValsetRequest([{ key: CFG_KEY_RATE_MEAS, value: periodMs }]);

/** CFG-VALGET の応答フレームを組み立てる（ヘッダ 4 バイト + キーと値の組の並び） */
function valgetReply(values: { pvtRate?: number; periodMs?: number }): Uint8Array {
  const bytes = [0x01, 0x00, 0x00, 0x00];
  const pushKey = (key: number) => bytes.push(key & 0xff, (key >>> 8) & 0xff, (key >>> 16) & 0xff, key >>> 24);
  if (values.pvtRate !== undefined) {
    pushKey(CFG_KEY_MSGOUT_NAV_PVT_USB);
    bytes.push(values.pvtRate);
  }
  if (values.periodMs !== undefined) {
    pushKey(CFG_KEY_RATE_MEAS);
    bytes.push(values.periodMs & 0xff, values.periodMs >> 8);
  }
  return buildUbxFrame(UBX_CLASS.CFG, UBX_ID.CFG_VALGET, bytes);
}

/** ACK-ACK / ACK-NAK フレームを組み立てる */
function ackFrame(accepted: boolean, targetClass: number, targetId: number): Uint8Array {
  return buildUbxFrame(
    UBX_CLASS.ACK,
    accepted ? UBX_ID.ACK_ACK : UBX_ID.ACK_NAK,
    new Uint8Array([targetClass, targetId]),
  );
}

const valsetAck = (accepted: boolean) => ackFrame(accepted, UBX_CLASS.CFG, UBX_ID.CFG_VALSET);

/** 書き込み内容とエラー通知を記録するテスト用の口 */
function createPorts(options: { canWrite?: boolean; failWrite?: boolean } = {}) {
  const written: Uint8Array[] = [];
  const errors: string[] = [];
  return {
    written,
    errors,
    ports: {
      canWrite: () => options.canWrite !== false,
      write: async (frame: Uint8Array) => {
        if (options.failWrite) throw new Error('書き込みに失敗しました');
        written.push(frame);
      },
      onError: (message: string) => errors.push(message),
    },
  };
}

/** 照会の応答と ACK をそろえて渡す */
function completeHandshake(
  negotiator: ReceiverConfigNegotiator,
  values: { pvtRate?: number; periodMs?: number },
): void {
  negotiator.handleFrame(valgetReply(values));
  negotiator.handleFrame(ackFrame(true, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));
}

describe('ReceiverConfigNegotiator', () => {
  it('start で NAV-PVT の出力レートと測位間隔を 1 回で照会する', async () => {
    const { written, ports } = createPorts();
    await new ReceiverConfigNegotiator(ports, 1000).start();
    assert.deepEqual(written, [QUERY]);
  });

  it('元の出力が無効なら有効化フレームを一度だけ送る', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();

    assert.deepEqual(written, [ENABLE_PVT]);
    assert.equal(negotiator.hasTemporaryOutput, true);

    // 応答が再送されても二重には撃たない
    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    assert.equal(written.length, 1);
  });

  it('既に出力していて測位間隔も選んだ値なら、受信機の設定には触らない', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });
    await Promise.resolve();

    assert.deepEqual(written, []);
    assert.equal(negotiator.hasTemporaryOutput, false);
  });

  it('測位間隔が選んだ値と違えば書き換える', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 200);

    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });
    await Promise.resolve();

    assert.deepEqual(written, [setPeriod(200)]);
  });

  it('応答と ACK が揃うまで書かない（到着順は問わない）', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 200);

    // ACK が先に届いても、照会応答が来るまでは撃たない
    negotiator.handleFrame(ackFrame(true, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));
    await Promise.resolve();
    assert.deepEqual(written, []);

    negotiator.handleFrame(valgetReply({ pvtRate: 0, periodMs: 1000 }));
    await Promise.resolve();
    assert.deepEqual(written, [ENABLE_PVT, setPeriod(200)]);
  });

  it('照会前に選び直した測位間隔は、照会が揃った時点で書く', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    negotiator.setMeasurementPeriod(100);
    await Promise.resolve();
    assert.deepEqual(written, []);

    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });
    await Promise.resolve();
    assert.deepEqual(written, [setPeriod(100)]);
  });

  it('接続中に選び直すとその場で書き、受信機が既にその値なら書かない', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);
    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });

    negotiator.setMeasurementPeriod(200);
    negotiator.setMeasurementPeriod(200);
    negotiator.setMeasurementPeriod(1000);
    await Promise.resolve();

    assert.deepEqual(written, [setPeriod(200), setPeriod(1000)]);
  });

  it('書き込み経路が閉じている間は書かない', async () => {
    const { written, ports } = createPorts({ canWrite: false });
    const negotiator = new ReceiverConfigNegotiator(ports, 200);

    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();

    assert.deepEqual(written, []);
    assert.equal(negotiator.hasTemporaryOutput, false);
  });

  it('有効化の書き込みに失敗したら状態を巻き戻してエラーを通知する', async () => {
    const { errors, ports } = createPorts({ failWrite: true });
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(negotiator.hasTemporaryOutput, false);
    assert.deepEqual(errors, ['書き込みに失敗しました']);
  });

  it('照会が拒否されたらエラーを通知する', () => {
    const { errors, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    negotiator.handleFrame(ackFrame(false, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /照会を拒否/);
  });

  it('有効化が拒否されたら復帰対象から外す', async () => {
    const { errors, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    assert.equal(negotiator.hasTemporaryOutput, true);

    negotiator.handleFrame(valsetAck(false));

    assert.equal(negotiator.hasTemporaryOutput, false);
    assert.match(errors[0], /開始設定を拒否/);
  });

  it('書き込みへの ACK / NAK は送った順に割り当てる', async () => {
    // 有効化が通り、測位間隔の変更が拒否された場合
    const first = createPorts();
    const rateRejected = new ReceiverConfigNegotiator(first.ports, 200);
    completeHandshake(rateRejected, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    assert.deepEqual(first.written, [ENABLE_PVT, setPeriod(200)]);

    rateRejected.handleFrame(valsetAck(true));
    rateRejected.handleFrame(valsetAck(false));
    assert.equal(rateRejected.hasTemporaryOutput, true);
    assert.equal(first.errors.length, 1);
    assert.match(first.errors[0], /測位レートの変更を拒否/);

    // 有効化が拒否され、測位間隔の変更が通った場合
    const second = createPorts();
    const pvtRejected = new ReceiverConfigNegotiator(second.ports, 200);
    completeHandshake(pvtRejected, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();

    pvtRejected.handleFrame(valsetAck(false));
    pvtRejected.handleFrame(valsetAck(true));
    assert.equal(pvtRejected.hasTemporaryOutput, false);
    assert.equal(second.errors.length, 1);
    assert.match(second.errors[0], /開始設定を拒否/);
  });

  it('測位間隔の変更が拒否されたら、同じ値が選ばれても書き直す', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 200);
    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });
    negotiator.handleFrame(valsetAck(false));

    negotiator.setMeasurementPeriod(200);
    await Promise.resolve();

    assert.deepEqual(written, [setPeriod(200), setPeriod(200)]);
  });

  it('自分が送っていない書き込みへの NAK は無視する', () => {
    const { errors, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);
    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });

    negotiator.handleFrame(valsetAck(false));

    assert.deepEqual(errors, []);
  });

  it('CFG 以外への ACK は無視する', () => {
    const { errors, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    negotiator.handleFrame(ackFrame(false, UBX_CLASS.NAV, UBX_ID.NAV_PVT));

    assert.deepEqual(errors, []);
  });

  it('照会の応答に測位間隔が無ければ、NAV-PVT の出力だけを扱う', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 200);

    completeHandshake(negotiator, { pvtRate: 0 });
    negotiator.setMeasurementPeriod(100);
    await Promise.resolve();

    assert.deepEqual(written, [ENABLE_PVT]);
  });

  it('restore は書き換えたものだけを 1 回の書き込みで元へ戻す', async () => {
    const both = createPorts();
    const bothNegotiator = new ReceiverConfigNegotiator(both.ports, 200);
    completeHandshake(bothNegotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    both.written.length = 0;

    await bothNegotiator.restore();
    assert.deepEqual(both.written, [buildValsetRequest([
      { key: CFG_KEY_MSGOUT_NAV_PVT_USB, value: 0 },
      { key: CFG_KEY_RATE_MEAS, value: 1000 },
    ])]);
    assert.equal(bothNegotiator.hasTemporaryOutput, false);

    // 二重に戻さない
    await bothNegotiator.restore();
    assert.equal(both.written.length, 1);

    const pvtOnly = createPorts();
    const pvtOnlyNegotiator = new ReceiverConfigNegotiator(pvtOnly.ports, 1000);
    completeHandshake(pvtOnlyNegotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    pvtOnly.written.length = 0;
    await pvtOnlyNegotiator.restore();
    assert.deepEqual(pvtOnly.written, [DISABLE_PVT]);

    const untouched = createPorts();
    const untouchedNegotiator = new ReceiverConfigNegotiator(untouched.ports, 1000);
    completeHandshake(untouchedNegotiator, { pvtRate: 1, periodMs: 1000 });
    await untouchedNegotiator.restore();
    assert.deepEqual(untouched.written, []);
  });

  it('いったん選び直した測位間隔は、元の値へ選び戻していても restore で書き戻す', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 200);
    completeHandshake(negotiator, { pvtRate: 1, periodMs: 1000 });
    negotiator.setMeasurementPeriod(1000);
    await Promise.resolve();
    written.length = 0;

    await negotiator.restore();

    assert.deepEqual(written, [buildValsetRequest([{ key: CFG_KEY_RATE_MEAS, value: 1000 }])]);
  });

  it('restore の後は、選び直されても照会応答が届いても書かない', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    await negotiator.restore();
    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    negotiator.setMeasurementPeriod(100);
    await Promise.resolve();

    assert.deepEqual(written, []);
  });

  it('reset 後は再び照会からやり直せる。選ばれている測位間隔は持ち越す', async () => {
    const { written, ports } = createPorts();
    const negotiator = new ReceiverConfigNegotiator(ports, 1000);

    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    negotiator.setMeasurementPeriod(200);
    await negotiator.restore();
    negotiator.reset();
    assert.equal(negotiator.hasTemporaryOutput, false);

    written.length = 0;
    completeHandshake(negotiator, { pvtRate: 0, periodMs: 1000 });
    await Promise.resolve();
    assert.deepEqual(written, [ENABLE_PVT, setPeriod(200)]);
  });
});
