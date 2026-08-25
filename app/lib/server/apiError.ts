import { NextResponse } from 'next/server';
import { NtripParameterError } from '../ntripHeader';
import { BlockedHostError } from './hostGuard';
import { NtripRequestError } from './ntripError';
import { ForbiddenOriginError } from './originGuard';

export { NtripRequestError };

/**
 * NTRIP 系 API ルートの catch 節から使う共通のエラー応答。
 *
 * 入力そのものが不正だった場合と接続先が拒否された場合は 400、
 * 越境呼び出しは 403、それ以外は上流の障害として 502 を返す。
 * 想定外の例外は文言を伏せ、既定メッセージへ丸める。
 */
export function toNtripErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ForbiddenOriginError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof BlockedHostError || error instanceof NtripParameterError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NtripRequestError) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 502 });
}
