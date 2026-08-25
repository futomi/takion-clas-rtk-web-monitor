import { NextRequest, NextResponse } from 'next/server';
import { concatBytes } from '@/app/lib/bytes';
import { DEFAULT_NTRIP_PASSWORD, DEFAULT_NTRIP_PORT } from '@/app/lib/ntrip';
import { buildNtripStreamRequest, parseNtripResponseHeader } from '@/app/lib/ntripHeader';
import { toNtripErrorResponse } from '@/app/lib/server/apiError';
import { openCasterSocket } from '@/app/lib/server/casterSocket';
import { isValidPort, resolveSafeTarget } from '@/app/lib/server/hostGuard';

/** net モジュールを使うため Node.js ランタイムを明示する */
export const runtime = 'nodejs';
/** 常にライブ接続を張るため静的化させない */
export const dynamic = 'force-dynamic';

/** 無通信が続いた場合に接続を切るまでの時間（ms） */
const STREAM_TIMEOUT_MS = 12000;

type StreamParams = {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
};

/**
 * 接続情報は POST のリクエストボディで受け取る。
 *
 * 認証情報をクエリ文字列に載せると、サーバーのアクセスログや
 * ブラウザ履歴・Referer に平文で残ってしまうため。
 */
async function readParams(request: NextRequest): Promise<StreamParams | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null) return null;
    const raw = body as Record<string, unknown>;
    return {
      host: typeof raw.host === 'string' ? raw.host : '',
      port: typeof raw.port === 'number' ? raw.port : Number.parseInt(String(raw.port ?? ''), 10) || DEFAULT_NTRIP_PORT,
      mountpoint: typeof raw.mountpoint === 'string' ? raw.mountpoint : '',
      username: typeof raw.username === 'string' ? raw.username : '',
      password: typeof raw.password === 'string' ? raw.password : DEFAULT_NTRIP_PASSWORD,
    };
  } catch {
    return null;
  }
}

/** Caster への TCP 接続を、ヘッダを取り除いた RTCM 本文の ReadableStream に変換する */
function createRtcmStream(address: string, params: StreamParams, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let headerPassed = false;
      let headerBuffer = new Uint8Array(0);
      /** コントローラは二重に閉じられないため、状態を持って一度だけ操作する */
      let controllerClosed = false;

      const closeController = (error?: Error) => {
        if (controllerClosed) return;
        controllerClosed = true;
        if (error) controller.error(error);
        else controller.close();
      };

      const connection = openCasterSocket({
        address,
        port: params.port,
        request: buildNtripStreamRequest(params.mountpoint, params.host, params.username, params.password),
        timeoutMs: STREAM_TIMEOUT_MS,
        timeoutMessage: 'NTRIPストリームの受信がタイムアウトしました。',
        onData: (chunk) => {
          if (headerPassed) {
            controller.enqueue(new Uint8Array(chunk));
            return;
          }

          headerBuffer = concatBytes(headerBuffer, chunk);

          const result = parseNtripResponseHeader(headerBuffer);
          if (result.status === 'pending') return;
          // 例外を投げれば接続が畳まれ、そのまま onFailure へ渡る
          if (result.status === 'error') throw new Error(result.message);

          headerPassed = true;
          const body = headerBuffer.subarray(result.bodyOffset);
          if (body.length > 0) controller.enqueue(new Uint8Array(body));
          headerBuffer = new Uint8Array(0);
        },
        onEnd: () => closeController(),
        onFailure: (error) => closeController(error),
      });

      // クライアントが切断したら Caster への接続も畳む
      if (signal.aborted) {
        connection.close();
        closeController();
      } else {
        signal.addEventListener('abort', () => {
          connection.close();
          closeController();
        }, { once: true });
      }
    },
  });
}

export async function POST(request: NextRequest) {
  const params = await readParams(request);

  if (!params || !params.host || !params.mountpoint || !isValidPort(params.port)) {
    return NextResponse.json(
      { error: 'ホスト名、ポート番号、マウントポイント名は必須です。' },
      { status: 400 },
    );
  }

  try {
    const target = await resolveSafeTarget(params.host);
    return new Response(createRtcmStream(target.address, params, request.signal), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    return toNtripErrorResponse(error, 'NTRIPストリームに接続できませんでした。');
  }
}
