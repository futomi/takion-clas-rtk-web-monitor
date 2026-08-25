import { concatBytes } from '../bytes';
import { buildNtripStreamRequest, parseNtripResponseHeader } from '../ntripHeader';
import { openCasterSocket, type CasterSocketHandle } from './casterSocket';
import { NtripRequestError } from './ntripError';

/**
 * NTRIP Caster からの RTCM 中継。
 *
 * 「接続してヘッダを読み切る」ところと「本文を流す」ところを分けてあるのは、
 * ヘッダの成否が確定してから HTTP 応答を組み立てたいため。本文のストリームを先に返すと
 * ステータスコードが 200 で確定した後にしか失敗が分からず、
 * 「マウントポイントが見つかりません」「認証に失敗しました」といった理由を
 * 利用者へ伝える手段が無くなってしまう。
 *
 * `next/server` へ依存しないので、この中継処理だけを単体で動かして確かめられる。
 */

/** 無通信が続いた場合に接続を切るまでの時間（ms） */
export const STREAM_TIMEOUT_MS = 12000;

/**
 * 消費側へ渡す前に溜めてよいバイト数。
 *
 * RTCM は毎秒 1〜5 KB 程度しか流れないため、通常はここに届かない。
 * 読み出しの遅いクライアントがぶら下がったときに、際限なく溜め込まないための上限。
 * これを超えると Caster 側の受信を止め、TCP の受信窓で送信元に待ってもらう。
 */
const MAX_BUFFERED_BYTES = 256 * 1024;

export type NtripStreamParams = {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
};

/** ヘッダ通過後の本文を受け取る口 */
export type BodyHandlers = {
  onData: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onFailure: (error: Error) => void;
};

/** 応答ヘッダを読み終えた Caster 接続 */
export type CasterSession = {
  connection: CasterSocketHandle;
  /**
   * 本文の受け口を差し込む。
   *
   * ヘッダ解析の完了から差し込みまでの間に届いたチャンクは内部に溜めてあり、
   * ここでまとめて流し込まれる。受け取り手が居ない一瞬に届いた RTCM を落とさないため。
   */
  attach: (handlers: BodyHandlers) => void;
};

/**
 * Caster へ接続し、応答ヘッダを読み切るまで待つ。
 *
 * @param address SSRF 検査を通した接続先 IP（{@link ./hostGuard} の結果）
 */
// 入力検査の失敗も同期例外ではなく拒否として返したいので async にしてある
export async function openCasterSession(
  address: string,
  params: NtripStreamParams,
  timeoutMs: number = STREAM_TIMEOUT_MS,
): Promise<CasterSession> {
  // 危険な文字を含む入力はここで弾かれる。ソケットを開く前に落としたいので先に組み立てる
  const request = buildNtripStreamRequest(params.mountpoint, params.host, params.username, params.password);

  return new Promise<CasterSession>((resolve, reject) => {
    let headerBuffer: Uint8Array = new Uint8Array(0);
    let headerPassed = false;

    let body: BodyHandlers | null = null;
    /** 受け口が差し込まれるまでに届いた本文 */
    const buffered: Uint8Array[] = [];
    /** 受け口が差し込まれるまでに確定した終了状態 */
    let terminated: { error?: Error } | null = null;

    const attach = (handlers: BodyHandlers): void => {
      body = handlers;
      for (const chunk of buffered) handlers.onData(chunk);
      buffered.length = 0;
      if (!terminated) return;
      if (terminated.error) handlers.onFailure(terminated.error);
      else handlers.onEnd();
    };

    /** 本文を受け口へ渡す。まだ差し込まれていなければ溜める */
    const pushBody = (chunk: Uint8Array) => {
      if (body) body.onData(chunk);
      else buffered.push(chunk);
    };

    /** 終了・失敗を受け口へ渡す。まだ差し込まれていなければ覚えておく */
    const finishBody = (error?: Error) => {
      if (!body) {
        terminated = { error };
        return;
      }
      if (error) body.onFailure(error);
      else body.onEnd();
    };

    const connection = openCasterSocket({
      address,
      port: params.port,
      request,
      timeoutMs,
      timeoutMessage: 'NTRIPストリームの受信がタイムアウトしました。',
      onData: (chunk) => {
        if (headerPassed) {
          // Node はソケットのバッファを使い回すため、そのまま渡さず必ず複製する
          pushBody(new Uint8Array(chunk));
          return;
        }

        headerBuffer = concatBytes(headerBuffer, chunk);

        const result = parseNtripResponseHeader(headerBuffer);
        if (result.status === 'pending') return;
        // 例外を投げれば接続が畳まれ、そのまま onFailure へ渡る
        if (result.status === 'error') throw new NtripRequestError(result.message);

        headerPassed = true;
        // ヘッダと同じパケットに本文の先頭が入っていることがある。取りこぼさない
        const head = headerBuffer.subarray(result.bodyOffset);
        if (head.length > 0) buffered.push(new Uint8Array(head));
        headerBuffer = new Uint8Array(0);
        resolve({ connection, attach });
      },
      // ヘッダを読み切る前に切れた場合は、接続の失敗として呼び出し側へ返す
      onEnd: () => {
        if (headerPassed) finishBody();
        else reject(new NtripRequestError('NTRIP Casterが応答を返さずに接続を閉じました。'));
      },
      onFailure: (error) => {
        if (headerPassed) finishBody(error);
        else reject(error);
      },
    });
  });
}

/**
 * ヘッダ通過後の Caster 接続を RTCM 本文の ReadableStream に変換する。
 *
 * クライアントの切断（`signal`）と消費側のキャンセル（`cancel`）のどちらでも
 * Caster 側の TCP を必ず畳む。RTCM は途切れず流れ続けるため無通信タイムアウトが働かず、
 * 畳み忘れるとその接続はプロセスが終わるまで残ってしまう。
 *
 * 消費側が読み出しに追いつかない場合は Caster 側の受信を止めて背圧をかける。
 * 溜め込みを続けると、遅いクライアント 1 つでプロセスのメモリを圧迫できてしまうため。
 *
 * @param releaseSlot 経路が分かれても取りこぼさないよう、何度呼んでもよい解放関数を渡す
 */
export function createRtcmStream(
  session: CasterSession,
  signal: AbortSignal,
  releaseSlot: () => void = () => {},
): ReadableStream<Uint8Array> {
  /** コントローラは二重に閉じられないため、状態を持って一度だけ操作する */
  let closed = false;
  let closeController: (error?: Error) => void = () => {};
  /** 中断の購読を外す。終わった中継のリスナーをリクエストの signal へ残さない */
  let detachAbort: () => void = () => {};

  const shutdown = (error?: Error) => {
    detachAbort();
    session.connection.close();
    closeController(error);
    releaseSlot();
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      closeController = (error) => {
        if (closed) return;
        closed = true;
        if (error) controller.error(error);
        else controller.close();
      };

      // クライアントが切断したら Caster への接続も畳む。
      // 購読は `attach` より先に張る。溜まっていた終了状態が `attach` の中で即座に
      // 流れ出すことがあり、後から張ると外す機会を逃したリスナーが残ってしまう
      const onAbort = () => shutdown();
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        detachAbort = () => signal.removeEventListener('abort', onAbort);
      }

      session.attach({
        onData: (chunk) => {
          if (closed) return;
          controller.enqueue(chunk);
          // 溜まった量が上限に達したら受信を止める。`pull` で再開する
          if ((controller.desiredSize ?? 1) <= 0) session.connection.pause();
        },
        onEnd: () => {
          detachAbort();
          closeController();
          releaseSlot();
        },
        onFailure: (error) => {
          detachAbort();
          closeController(error);
          releaseSlot();
        },
      });
    },
    pull() {
      // 消費側が読み進めて空きができた。止めていた受信を再開する
      if (!closed) session.connection.resume();
    },
    cancel() {
      detachAbort();
      closed = true;
      session.connection.close();
      releaseSlot();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: MAX_BUFFERED_BYTES }));
}
