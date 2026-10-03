import { GGA_QUALITY } from './constants';
import { clearPositionFields, type Telemetry } from './telemetry';
import type { ParsedMessage } from './types';

/** UBX フレームの固定長オーバーヘッド（同期 2 + クラス/ID 2 + 長さ 2 + チェックサム 2） */
export const UBX_FRAME_OVERHEAD = 8;
/** ペイロード先頭のオフセット */
const UBX_PAYLOAD_OFFSET = 6;

/** UBX メッセージクラス */
export const UBX_CLASS = { NAV: 0x01, RXM: 0x02, ACK: 0x05, CFG: 0x06 } as const;
/** 本アプリが識別する UBX メッセージ ID */
export const UBX_ID = {
  NAV_PVT: 0x07,
  NAV_STATUS: 0x03,
  NAV_SIG: 0x43,
  RXM_QZSSL6: 0x73,
  ACK_ACK: 0x01,
  ACK_NAK: 0x00,
  CFG_VALGET: 0x8b,
  CFG_VALSET: 0x8a,
} as const;

/**
 * u-blox が定義しているメッセージクラスの一覧。
 *
 * 走査中に同期バイト `B5 62` を見つけても、それが本物のフレーム先頭とは限らない。
 * 続く 1 バイトがこの一覧に無ければ、たまたま並んだ 2 バイトだと判断できる。
 * 偽の同期を長さ表記ごと信じてしまうと、そのフレームが揃うまで後続の正常な電文が
 * 一切表示されなくなる（最大 16 KB ぶん、38400 bps なら数秒）ため、
 * 確かめられるうちに弾いておく。
 *
 * 本アプリが解析するのは一部だけだが、解析しないクラスもログには残したいので、
 * u-blox が採番しているクラスはすべて通す。
 */
const KNOWN_UBX_CLASSES = new Set([
  0x01, // NAV
  0x02, // RXM
  0x04, // INF
  0x05, // ACK
  0x06, // CFG
  0x09, // UPD
  0x0a, // MON
  0x0b, // AID（旧世代）
  0x0d, // TIM
  0x10, // ESF
  0x13, // MGA
  0x21, // LOG
  0x27, // SEC
  0x28, // HNR
  0x29, // NAV2
  0xf5, // RTCM
]);

/** u-blox が採番しているメッセージクラスか。フレーム走査時の同期確認に使う */
export function isKnownUbxClass(messageClass: number): boolean {
  return KNOWN_UBX_CLASSES.has(messageClass);
}

/** CFG キー: USB ポートにおける NAV-PVT 出力レート */
export const CFG_KEY_MSGOUT_NAV_PVT_USB = 0x20910009;
/** CFG キー: 測位の間隔（ms）。受信機が 1 秒に何回測位解を出すかはこれで決まる */
export const CFG_KEY_RATE_MEAS = 0x30210001;

/** CFG-VALGET で読む層。RAM 層は今まさに効いている値を持つ */
const CFG_VALGET_LAYER_RAM = 0x00;
/** CFG-VALSET で書く層（ビットマスク）。RAM 層だけに書くので、電源を切れば元へ戻る */
const CFG_VALSET_LAYERS_RAM = 0x01;

/** CFG-VALSET で書く 1 項目 */
export type CfgItem = { key: number; value: number };

const toHexByte = (value: number) => value.toString(16).toUpperCase().padStart(2, '0');

/** フレーム先頭 6 バイトからペイロード長（リトルエンディアン 16bit）を読む */
export function readUbxPayloadLength(frame: Uint8Array, offset = 0): number {
  return frame[offset + 4] | (frame[offset + 5] << 8);
}

/**
 * 設定キーが運ぶ値のバイト数。キー ID の 28〜30 ビットが大きさを表す。
 * 1 ビット型も 1 バイトで運ばれる。大きさを表さない値なら null。
 */
function cfgValueSize(key: number): number | null {
  switch ((key >>> 28) & 0x07) {
    case 1:
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 4;
    case 5:
      return 8;
    default:
      return null;
  }
}

function readCfgValue(view: DataView, offset: number, size: number): number {
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset, true);
  if (size === 4) return view.getUint32(offset, true);
  return Number(view.getBigUint64(offset, true));
}

function writeCfgValue(view: DataView, offset: number, size: number, value: number): void {
  if (size === 1) view.setUint8(offset, value);
  else if (size === 2) view.setUint16(offset, value, true);
  else if (size === 4) view.setUint32(offset, value, true);
  else view.setBigUint64(offset, BigInt(value), true);
}

/** UBX の 8bit Fletcher チェックサム。クラスからペイロード末尾までを畳み、CK_A を上位に詰めて返す */
function ubxChecksum(frame: Uint8Array): number {
  let checksumA = 0;
  let checksumB = 0;
  for (let index = 2; index < frame.length - 2; index += 1) {
    checksumA = (checksumA + frame[index]) & 0xff;
    checksumB = (checksumB + checksumA) & 0xff;
  }
  return (checksumA << 8) | checksumB;
}

/** クラス・ID・ペイロードから、チェックサムまで埋めた UBX フレームを組み立てる */
function buildUbxFrame(messageClass: number, messageId: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + UBX_FRAME_OVERHEAD);
  frame.set([0xb5, 0x62, messageClass, messageId, payload.length & 0xff, payload.length >> 8]);
  frame.set(payload, UBX_PAYLOAD_OFFSET);
  const checksum = ubxChecksum(frame);
  frame[frame.length - 2] = checksum >> 8;
  frame[frame.length - 1] = checksum & 0xff;
  return frame;
}

/** 指定キーの今の値を受信機へ尋ねる UBX-CFG-VALGET。1 回で複数のキーを尋ねられる */
export function buildValgetRequest(keys: readonly number[]): Uint8Array {
  // 先頭 4 バイトは version（0 = 照会）・層・position（0 = 先頭から返させる）
  const payload = new Uint8Array(4 + keys.length * 4);
  const view = new DataView(payload.buffer);
  view.setUint8(1, CFG_VALGET_LAYER_RAM);
  keys.forEach((key, index) => view.setUint32(4 + index * 4, key, true));
  return buildUbxFrame(UBX_CLASS.CFG, UBX_ID.CFG_VALGET, payload);
}

/** 設定を受信機の RAM 層へ書く UBX-CFG-VALSET。電源を切れば元の設定へ戻る */
export function buildValsetRequest(items: readonly CfgItem[]): Uint8Array {
  const sizes = items.map(({ key }) => {
    const size = cfgValueSize(key);
    if (size === null) throw new Error(`値の大きさが分からない設定キーです: 0x${key.toString(16)}`);
    return size;
  });
  // 先頭 4 バイトは version（0）・書く層・予約 2 バイト
  const payload = new Uint8Array(4 + sizes.reduce((total, size) => total + 4 + size, 0));
  const view = new DataView(payload.buffer);
  view.setUint8(1, CFG_VALSET_LAYERS_RAM);
  let offset = 4;
  items.forEach(({ key, value }, index) => {
    view.setUint32(offset, key, true);
    writeCfgValue(view, offset + 4, sizes[index], value);
    offset += 4 + sizes[index];
  });
  return buildUbxFrame(UBX_CLASS.CFG, UBX_ID.CFG_VALSET, payload);
}

/**
 * ヘッダが名乗るペイロード長が、実際のフレーム長と辻褄が合っているか。
 *
 * ペイロードの読み出しは長さ表記を信じて `DataView` を張るため、
 * 短いフレームに大きな長さが書かれていると範囲外で例外になる。受信ループの中で投げると
 * 読み取りごと止まってしまうため、解析へ進む前にここで弾く。
 * {@link ../frameScanner} を通ったフレームは必ず整合するが、
 * 解析関数は単体でも呼べるので、その前提に頼らない。
 */
function payloadLengthIsConsistent(frame: Uint8Array): boolean {
  return frame.length >= readUbxPayloadLength(frame) + UBX_FRAME_OVERHEAD;
}

/** UBX の 8bit Fletcher チェックサムを検証する */
export function ubxChecksumIsValid(frame: Uint8Array): boolean {
  return ubxChecksum(frame) === ((frame[frame.length - 2] << 8) | frame[frame.length - 1]);
}

/** クラス/ID の組から辞書引きに使う電文種別名を決める。未知の組は 16 進表記にフォールバック */
export function ubxMessageType(messageClass: number, messageId: number): string {
  if (messageClass === UBX_CLASS.NAV && messageId === UBX_ID.NAV_PVT) return 'PVT';
  if (messageClass === UBX_CLASS.NAV && messageId === UBX_ID.NAV_STATUS) return 'STATUS';
  if (messageClass === UBX_CLASS.NAV && messageId === UBX_ID.NAV_SIG) return 'SIG';
  if (messageClass === UBX_CLASS.RXM && messageId === UBX_ID.RXM_QZSSL6) return 'QZSSL6';
  if (messageClass === UBX_CLASS.CFG && messageId === UBX_ID.CFG_VALGET) return 'CFG-VALGET';
  if (messageClass === UBX_CLASS.ACK && messageId === UBX_ID.ACK_ACK) return 'ACK-ACK';
  if (messageClass === UBX_CLASS.ACK && messageId === UBX_ID.ACK_NAK) return 'ACK-NAK';
  return `${toHexByte(messageClass)}/${toHexByte(messageId)}`;
}

/**
 * UBX-CFG-VALGET の応答から、キーと値の組をすべて取り出す。応答でなければ null。
 *
 * 1 回の照会で複数のキーを尋ねられるため、値はキーが名乗る大きさに従って順に読み進める。
 * 大きさの分からないキーに当たったら、そこから先は区切りが読めないので打ち切る。
 */
export function readValgetValues(frame: Uint8Array): Map<number, number> | null {
  const payloadLength = readUbxPayloadLength(frame);
  if (frame[2] !== UBX_CLASS.CFG || frame[3] !== UBX_ID.CFG_VALGET || payloadLength < 4) return null;
  if (!payloadLengthIsConsistent(frame)) return null;
  const payload = new DataView(frame.buffer, frame.byteOffset + UBX_PAYLOAD_OFFSET, payloadLength);
  const values = new Map<number, number>();
  for (let offset = 4; offset + 4 <= payloadLength;) {
    const key = payload.getUint32(offset, true);
    const size = cfgValueSize(key);
    if (size === null || offset + 4 + size > payloadLength) break;
    values.set(key, readCfgValue(payload, offset + 4, size));
    offset += 4 + size;
  }
  return values;
}

/** ACK-ACK / ACK-NAK が「どのコマンドに対する応答か」を返す。ACK 系でなければ null */
export function readAckTarget(frame: Uint8Array): { accepted: boolean; targetClass: number; targetId: number } | null {
  if (frame[2] !== UBX_CLASS.ACK || readUbxPayloadLength(frame) < 2) return null;
  return { accepted: frame[3] === UBX_ID.ACK_ACK, targetClass: frame[6], targetId: frame[7] };
}

/** NAV-PVT の flags が示す搬送波位相解の状態 */
const CARRIER_SOLUTION = { NONE: 0, FLOAT: 1, FIXED: 2 } as const;

/**
 * NAV-PVT のフラグ群を NMEA の GGA 測位品質コードへ正規化する。
 * UBX と NMEA のどちらから測位解が来ても、UI 側は同じコード体系だけを見ればよくなる。
 */
function toGgaQuality(hasFix: boolean, carrierSolution: number, hasDifferential: boolean): number {
  if (!hasFix) return GGA_QUALITY.NO_FIX;
  if (carrierSolution === CARRIER_SOLUTION.FIXED) return GGA_QUALITY.PRECISE_FIX;
  if (carrierSolution === CARRIER_SOLUTION.FLOAT) return GGA_QUALITY.PRECISE_FLOAT;
  return hasDifferential ? GGA_QUALITY.DGPS : GGA_QUALITY.STANDALONE;
}

/** NAV-PVT ペイロードから測位解を組み立てる */
function parseNavPvt(payload: DataView, update: Partial<Telemetry>): void {
  const fixType = payload.getUint8(20);
  const flags = payload.getUint8(21);
  const carrierSolution = (flags >> 6) & 0x03;
  const hasFix = (flags & 0x01) !== 0 && fixType >= 2;
  const hasDifferential = (flags & 0x02) !== 0;

  update.quality = toGgaQuality(hasFix, carrierSolution, hasDifferential);
  update.satellitesUsed = payload.getUint8(23);

  if (hasFix) {
    update.longitude = payload.getInt32(24, true) * 1e-7;
    update.latitude = payload.getInt32(28, true) * 1e-7;
    const ellipsoidHeight = payload.getInt32(32, true) / 1000;
    update.altitude = payload.getInt32(36, true) / 1000;
    update.geoidSeparation = ellipsoidHeight - update.altitude;
    const horizontalError = payload.getUint32(40, true);
    const verticalError = payload.getUint32(44, true);
    // 0xFFFFFFFF は「推定不能」を表すセンチネル値
    update.horizontalError = horizontalError === 0xffffffff ? undefined : horizontalError / 1000;
    update.verticalError = verticalError === 0xffffffff ? undefined : verticalError / 1000;
    update.speedKmh = payload.getInt32(60, true) * 0.0036;
    update.course = payload.getInt32(64, true) * 1e-5;
    const pdop = payload.getUint16(76, true);
    update.pdop = pdop === 0xffff ? undefined : pdop * 0.01;
  } else {
    clearPositionFields(update);
    // 速度・方位・PDOP は NAV-PVT 自身が載せている値なので、この電文の責任で消す
    update.speedKmh = undefined;
    update.course = undefined;
    update.pdop = undefined;
  }

  // validDate(bit0) と validTime(bit1) が両方立っている場合のみ日時を採用する
  const timeValid = payload.getUint8(11);
  if ((timeValid & 0x03) === 0x03) {
    /*
     * 秒の端数（nano）まで含めて 1/100 秒に丸める。測位レートを 1 Hz より上げると
     * 1 秒の中に複数のエポックが入り、秒までの時刻では見分けられなくなるため。
     * 桁は NMEA の時刻（hhmmss.ss）に揃え、同じエポックなら同じ文字列になるようにする。
     *
     * nano は負にもなり（例: 56 秒 - 0.000001 秒）、丸めると秒・分・日付まで繰り上がることがある。
     * その繰り上がり・繰り下がりは Date に任せる。
     */
    const centiseconds = Math.round(payload.getInt32(16, true) / 1e7);
    const at = new Date(Date.UTC(
      payload.getUint16(4, true),
      payload.getUint8(6) - 1,
      payload.getUint8(7),
      payload.getUint8(8),
      payload.getUint8(9),
      payload.getUint8(10),
    ) + centiseconds * 10);
    const pad = (value: number) => String(value).padStart(2, '0');
    update.dateUtc = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
    update.timeUtc = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`
      + `.${pad(at.getUTCMilliseconds() / 10)}`;
  }
}

/**
 * UBX バイナリフレーム 1 件を解析する。
 *
 * @param verifiedChecksum 検証済みなら、その結果。フレーム走査で済ませた検証を
 *   受け取り、同じ Fletcher 計算をフレームごとに二度走らせないためのもの。
 *   省略した場合はこの場で検証するので、単体でもそのまま呼べる。
 */
export function parseUbx(frame: Uint8Array, verifiedChecksum?: boolean): ParsedMessage {
  const messageClass = frame[2];
  const messageId = frame[3];
  const payloadLength = readUbxPayloadLength(frame);
  const type = ubxMessageType(messageClass, messageId);
  const valid = verifiedChecksum ?? ubxChecksumIsValid(frame);
  const update: Partial<Telemetry> = {};

  if (!valid || !payloadLengthIsConsistent(frame)) return { type, valid, update };

  const ack = readAckTarget(frame);
  if (ack) {
    return {
      type,
      valid,
      update,
      summary: `UBX-${type} · command ${toHexByte(ack.targetClass)}/${toHexByte(ack.targetId)}`,
    };
  }

  if (type === 'QZSSL6' && payloadLength >= 14) {
    const payload = new DataView(frame.buffer, frame.byteOffset + UBX_PAYLOAD_OFFSET, payloadLength);
    const svId = payload.getUint8(1);
    const cno = payload.getUint16(2, true) / 256;
    const channelInfo = payload.getUint16(10, true);
    // bit10 が L6E / L6D の区別を表す
    const signal = (channelInfo & (1 << 10)) !== 0 ? 'L6E' : 'L6D';
    return {
      type,
      valid,
      update,
      summary: `UBX-RXM-QZSSL6 · ${signal} / SV ${svId} / C/N0 ${cno.toFixed(1)} dBHz`,
    };
  }

  if (type !== 'PVT' || payloadLength < 92) return { type, valid, update };

  parseNavPvt(new DataView(frame.buffer, frame.byteOffset + UBX_PAYLOAD_OFFSET, payloadLength), update);
  return { type, valid, update };
}
