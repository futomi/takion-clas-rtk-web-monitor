import * as net from 'node:net';
import { NtripRequestError } from './apiError';

/**
 * NTRIP Caster への TCP 接続を開き、決まった後始末を必ず通す。
 *
 * Source-table 取得とストリーム中継はどちらも「解決済み IP へ繋ぐ → リクエスト行を送る →
 * 無通信タイムアウトを張る → エラー・終了・タイムアウト・呼び出し側の中断のいずれでも
 * 一度だけ片付ける」という同じ骨格を持つ。片方だけ後始末を直して他方が漏れることのないよう、
 * その骨格をここへ集約する。
 */
export type CasterSocketOptions = {
  /** 接続先 IP。SSRF 検査を通した {@link ./hostGuard} の結果を渡す */
  address: string;
  port: number;
  /** 接続確立時に送るリクエスト文字列 */
  request: string;
  /** 無通信が続いた場合に接続を切るまでの時間（ms） */
  timeoutMs: number;
  /** タイムアウト時に利用者へ見せるメッセージ */
  timeoutMessage: string;
  /**
   * 受信チャンク。ここで例外を投げると受信を打ち切り、その例外が `onFailure` へ渡る。
   * 受信量の上限超過など、呼び出し側の都合で中断したい場合に使う。
   */
  onData: (chunk: Buffer) => void;
  /** 相手が正常に送信を終えた。`onFailure` とは排他で、片方だけが 1 回呼ばれる */
  onEnd: () => void;
  /** 通信エラー・タイムアウト・`onData` の例外 */
  onFailure: (error: Error) => void;
};

/** 開いた接続を外から畳むためのハンドル */
export type CasterSocketHandle = {
  /** 接続を閉じる。以降 `onEnd` も `onFailure` も呼ばれない */
  close: () => void;
};

export function openCasterSocket({
  address,
  port,
  request,
  timeoutMs,
  timeoutMessage,
  onData,
  onEnd,
  onFailure,
}: CasterSocketOptions): CasterSocketHandle {
  let settled = false;

  const socket = net.createConnection({ host: address, port }, () => {
    socket.write(request);
  });

  /** 通知は一度きり。ソケットは何があっても必ず破棄する */
  const settle = (notify?: () => void) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    notify?.();
  };

  socket.setTimeout(timeoutMs);

  socket.on('data', (chunk: Buffer) => {
    if (settled) return;
    try {
      onData(chunk);
    } catch (error) {
      settle(() => onFailure(error instanceof Error ? error : new Error(String(error))));
    }
  });
  socket.on('end', () => settle(onEnd));
  socket.on('error', (error) => settle(() => onFailure(error)));
  // タイムアウトはこちらが意図して打ち切るものなので、利用者に見せてよいエラーとして通知する
  socket.on('timeout', () => settle(() => onFailure(new NtripRequestError(timeoutMessage))));

  return { close: () => settle() };
}
