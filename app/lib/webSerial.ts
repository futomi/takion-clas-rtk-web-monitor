/**
 * Web Serial API の最小限の型定義。
 * `@types/w3c-web-serial` を追加せずに済ませるため、本アプリが使う範囲だけを宣言する。
 */

export type SerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
};

export type SerialOpenOptions = {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
};

export type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
};

export type SerialApi = {
  requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike>;
};

type NavigatorWithSerial = Navigator & { serial?: SerialApi };

/** 現在の実行環境で Web Serial API が使えるかを返す */
export function getSerialApi(): SerialApi | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as NavigatorWithSerial).serial;
}
