import { NextResponse } from 'next/server';
import { BlockedHostError } from './hostGuard';

/**
 * 利用者にそのまま提示してよいエラー。
 *
 * タイムアウトや受信上限の超過など、こちらが意図して投げたものだけをこの型で表す。
 * 素の socket エラー（`ECONNREFUSED …` など、内部構成が透ける文言）と区別するために使う。
 */
export class NtripRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NtripRequestError';
  }
}

/**
 * NTRIP 系 API ルートの catch 節から使う共通のエラー応答。
 *
 * 接続先が拒否された場合は 400、それ以外は上流の障害として 502 を返す。
 * 想定外の例外は文言を伏せ、既定メッセージへ丸める。
 */
export function toNtripErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof BlockedHostError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NtripRequestError) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 502 });
}
