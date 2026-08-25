import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PvtOutputNegotiator } from '../app/lib/pvtOutputNegotiator.ts';
import {
  CFG_KEY_MSGOUT_NAV_PVT_USB,
  DISABLE_NAV_PVT_USB_RAM,
  ENABLE_NAV_PVT_USB_RAM,
  GET_NAV_PVT_USB_RATE,
  UBX_CLASS,
  UBX_ID,
} from '../app/lib/ubx.ts';
import { buildUbxFrame } from './helpers.ts';

/** CFG-VALGET の応答フレームを組み立てる（ヘッダ 4 バイト + キー 4 バイト + 値） */
function valgetReply(key: number, rate: number): Uint8Array {
  const payload = new Uint8Array(9);
  new DataView(payload.buffer).setUint32(4, key, true);
  payload[8] = rate;
  return buildUbxFrame(UBX_CLASS.CFG, UBX_ID.CFG_VALGET, payload);
}

/** ACK-ACK / ACK-NAK フレームを組み立てる */
function ackFrame(accepted: boolean, targetClass: number, targetId: number): Uint8Array {
  return buildUbxFrame(
    UBX_CLASS.ACK,
    accepted ? UBX_ID.ACK_ACK : UBX_ID.ACK_NAK,
    new Uint8Array([targetClass, targetId]),
  );
}

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

/** 出力レート照会の応答と ACK をそろえて渡す */
function completeHandshake(negotiator: PvtOutputNegotiator, rate: number): void {
  negotiator.handleFrame(valgetReply(CFG_KEY_MSGOUT_NAV_PVT_USB, rate));
  negotiator.handleFrame(ackFrame(true, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));
}

describe('PvtOutputNegotiator', () => {
  it('start で出力レートの照会フレームを送る', async () => {
    const { written, ports } = createPorts();
    await new PvtOutputNegotiator(ports).start();
    assert.deepEqual(written, [GET_NAV_PVT_USB_RATE]);
  });

  it('元の出力が無効なら有効化フレームを一度だけ送る', async () => {
    const { written, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 0);
    await Promise.resolve();

    assert.deepEqual(written, [ENABLE_NAV_PVT_USB_RAM]);
    assert.equal(negotiator.hasTemporaryOutput, true);

    // 応答が再送されても二重には撃たない
    completeHandshake(negotiator, 0);
    assert.equal(written.length, 1);
  });

  it('既に出力している受信機の設定には触らない', async () => {
    const { written, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 1);
    await Promise.resolve();

    assert.deepEqual(written, []);
    assert.equal(negotiator.hasTemporaryOutput, false);
  });

  it('応答と ACK が揃うまで有効化しない（到着順は問わない）', async () => {
    const { written, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    // ACK が先に届いても、照会応答が来るまでは撃たない
    negotiator.handleFrame(ackFrame(true, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));
    await Promise.resolve();
    assert.deepEqual(written, []);

    negotiator.handleFrame(valgetReply(CFG_KEY_MSGOUT_NAV_PVT_USB, 0));
    await Promise.resolve();
    assert.deepEqual(written, [ENABLE_NAV_PVT_USB_RAM]);
  });

  it('書き込み経路が閉じている間は有効化しない', async () => {
    const { written, ports } = createPorts({ canWrite: false });
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 0);
    await Promise.resolve();

    assert.deepEqual(written, []);
    assert.equal(negotiator.hasTemporaryOutput, false);
  });

  it('有効化の書き込みに失敗したら状態を巻き戻してエラーを通知する', async () => {
    const { errors, ports } = createPorts({ failWrite: true });
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 0);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(negotiator.hasTemporaryOutput, false);
    assert.deepEqual(errors, ['書き込みに失敗しました']);
  });

  it('照会が拒否されたらエラーを通知する', () => {
    const { errors, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    negotiator.handleFrame(ackFrame(false, UBX_CLASS.CFG, UBX_ID.CFG_VALGET));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /照会を拒否/);
  });

  it('有効化が拒否されたら復帰対象から外す', async () => {
    const { errors, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 0);
    await Promise.resolve();
    assert.equal(negotiator.hasTemporaryOutput, true);

    negotiator.handleFrame(ackFrame(false, UBX_CLASS.CFG, UBX_ID.CFG_VALSET));

    assert.equal(negotiator.hasTemporaryOutput, false);
    assert.match(errors[0], /開始設定を拒否/);
  });

  it('CFG 以外への ACK は無視する', () => {
    const { errors, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    negotiator.handleFrame(ackFrame(false, UBX_CLASS.NAV, UBX_ID.NAV_PVT));

    assert.deepEqual(errors, []);
  });

  it('restore は自分で有効化した場合だけ元へ戻す', async () => {
    const enabled = createPorts();
    const enabledNegotiator = new PvtOutputNegotiator(enabled.ports);
    completeHandshake(enabledNegotiator, 0);
    await Promise.resolve();
    enabled.written.length = 0;

    await enabledNegotiator.restore();
    assert.deepEqual(enabled.written, [DISABLE_NAV_PVT_USB_RAM]);
    assert.equal(enabledNegotiator.hasTemporaryOutput, false);

    // 二重に戻さない
    await enabledNegotiator.restore();
    assert.equal(enabled.written.length, 1);

    const untouched = createPorts();
    const untouchedNegotiator = new PvtOutputNegotiator(untouched.ports);
    completeHandshake(untouchedNegotiator, 1);
    await untouchedNegotiator.restore();
    assert.deepEqual(untouched.written, []);
  });

  it('reset 後は再び照会からやり直せる', async () => {
    const { written, ports } = createPorts();
    const negotiator = new PvtOutputNegotiator(ports);

    completeHandshake(negotiator, 0);
    await Promise.resolve();
    negotiator.reset();
    assert.equal(negotiator.hasTemporaryOutput, false);

    written.length = 0;
    completeHandshake(negotiator, 0);
    await Promise.resolve();
    assert.deepEqual(written, [ENABLE_NAV_PVT_USB_RAM]);
  });
});
