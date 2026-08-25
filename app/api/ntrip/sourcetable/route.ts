import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_NTRIP_HOST, DEFAULT_NTRIP_PORT, parseSourceTable } from '@/app/lib/ntrip';
import { buildSourceTableRequest } from '@/app/lib/ntripHeader';
import { NtripRequestError, toNtripErrorResponse } from '@/app/lib/server/apiError';
import { openCasterSocket } from '@/app/lib/server/casterSocket';
import { isValidPort, resolveSafeTarget } from '@/app/lib/server/hostGuard';

/** net モジュールを使うため Node.js ランタイムを明示する */
export const runtime = 'nodejs';

/** Source-table 取得のタイムアウト（ms） */
const SOURCE_TABLE_TIMEOUT_MS = 8000;
/** 受信を打ち切る上限。巨大な Source-table でメモリを食い潰さないための安全弁 */
const MAX_SOURCE_TABLE_BYTES = 4 * 1024 * 1024;

/**
 * NTRIP Caster へ接続して Source-table 本文を取得する。
 *
 * 上限判定を実バイト数で行うため、受信中は Buffer のまま溜め、
 * 最後にまとめて UTF-8 として解釈する（文字数で数えるとマルチバイト分だけ上限が緩む）。
 */
function fetchSourceTable(address: string, host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    openCasterSocket({
      address,
      port,
      request: buildSourceTableRequest(host),
      timeoutMs: SOURCE_TABLE_TIMEOUT_MS,
      timeoutMessage: 'NTRIP Casterへの接続がタイムアウトしました。',
      onData: (chunk) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_SOURCE_TABLE_BYTES) {
          // 例外を投げると受信が打ち切られ、そのまま onFailure へ渡る
          throw new NtripRequestError('配信局一覧が大きすぎるため受信を中止しました。');
        }
        chunks.push(chunk);
      },
      onEnd: () => resolve(Buffer.concat(chunks).toString('utf8')),
      onFailure: reject,
    });
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const host = searchParams.get('host') || DEFAULT_NTRIP_HOST;
  const port = Number.parseInt(searchParams.get('port') || String(DEFAULT_NTRIP_PORT), 10);

  if (!isValidPort(port)) {
    return NextResponse.json({ error: '無効なポート番号です。' }, { status: 400 });
  }

  try {
    const target = await resolveSafeTarget(host);
    const rawData = await fetchSourceTable(target.address, host, port);
    const records = parseSourceTable(rawData);
    return NextResponse.json({ host, port, count: records.length, records });
  } catch (error) {
    return toNtripErrorResponse(error, 'Source-tableの取得に失敗しました。');
  }
}
