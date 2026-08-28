import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_NTRIP_PASSWORD, DEFAULT_NTRIP_PORT, isValidPort } from '@/app/lib/ntrip';
import { ntripUnavailableResponse, toNtripErrorResponse } from '@/app/lib/server/apiError';
import { createRtcmStream, openCasterSession, type NtripStreamParams } from '@/app/lib/server/casterStream';
import { resolveSafeTarget } from '@/app/lib/server/hostGuard';
import { isNtripAvailable } from '@/app/lib/server/ntripAvailability';
import { assertSameOrigin } from '@/app/lib/server/originGuard';
import { readJsonBody } from '@/app/lib/server/requestBody';
import { acquireStreamSlot } from '@/app/lib/server/streamLimit';

/** net モジュールを使うため Node.js ランタイムを明示する */
export const runtime = 'nodejs';
/** 常にライブ接続を張るため静的化させない */
export const dynamic = 'force-dynamic';

/**
 * リクエストボディとして受け付ける最大バイト数。
 * 載るのは接続先と認証情報だけなので、これで十分に余裕がある。
 */
const MAX_BODY_BYTES = 4096;

/**
 * 接続情報は POST のリクエストボディで受け取る。
 *
 * 認証情報をクエリ文字列に載せると、サーバーのアクセスログや
 * ブラウザ履歴・Referer に平文で残ってしまうため。
 *
 * 個々の値の長さは、リクエストを組み立てる {@link @/app/lib/ntripHeader} が検査する。
 */
async function readParams(request: NextRequest): Promise<NtripStreamParams | null> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (typeof body !== 'object' || body === null) return null;

  const raw = body as Record<string, unknown>;
  return {
    host: typeof raw.host === 'string' ? raw.host : '',
    port: typeof raw.port === 'number' ? raw.port : Number.parseInt(String(raw.port ?? ''), 10) || DEFAULT_NTRIP_PORT,
    mountpoint: typeof raw.mountpoint === 'string' ? raw.mountpoint : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    password: typeof raw.password === 'string' ? raw.password : DEFAULT_NTRIP_PASSWORD,
  };
}

export async function POST(request: NextRequest) {
  // 公開環境では中継そのものを提供しない。ソケットも入力検査も通らないよう、
  // 何をするより先に畳む
  if (!isNtripAvailable(request.headers)) return ntripUnavailableResponse();

  // JSON の POST なのでプリフライトが越境呼び出しを阻むが、
  // Source-table 側と同じ関門を通しておき、防御を経路ごとにばらけさせない
  try {
    assertSameOrigin(request.headers);
  } catch (error) {
    return toNtripErrorResponse(error, 'NTRIPストリームに接続できませんでした。');
  }

  const params = await readParams(request);
  // 本文を読めなかった場合と、読めたが中身が足りない場合は原因が違う。文言も分ける
  if (!params) {
    return NextResponse.json(
      { error: 'リクエストの内容を読み取れませんでした。送信内容が大きすぎる可能性があります。' },
      { status: 400 },
    );
  }

  if (!params.host || !params.mountpoint || !isValidPort(params.port)) {
    return NextResponse.json(
      { error: 'ホスト名、ポート番号、マウントポイント名は必須です。' },
      { status: 400 },
    );
  }

  const releaseSlot = acquireStreamSlot();
  if (!releaseSlot) {
    return NextResponse.json(
      { error: '同時接続数の上限に達しています。しばらく待って再試行してください。' },
      { status: 503 },
    );
  }

  try {
    const target = await resolveSafeTarget(params.host);
    // 応答ヘッダを読み切ってから応答を組み立てる。失敗の理由をそのまま返せるようにするため。
    // Host ヘッダには、検査を通した正規化済みのホスト名を載せる
    const session = await openCasterSession(target.address, { ...params, host: target.hostname });
    return new Response(createRtcmStream(session, request.signal, releaseSlot), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    releaseSlot();
    return toNtripErrorResponse(error, 'NTRIPストリームに接続できませんでした。');
  }
}
