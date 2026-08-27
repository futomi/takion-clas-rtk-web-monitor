import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_NTRIP_HOST,
  DEFAULT_NTRIP_PORT,
  isValidPort,
  parseSourceTable,
  toMountpointSummary,
} from '@/app/lib/ntrip';
import { buildSourceTableRequest } from '@/app/lib/ntripHeader';
import { NtripRequestError, toNtripErrorResponse } from '@/app/lib/server/apiError';
import { openCasterSocket } from '@/app/lib/server/casterSocket';
import { resolveSafeTarget } from '@/app/lib/server/hostGuard';
import { assertSameOrigin } from '@/app/lib/server/originGuard';
import { acquireSourceTableSlot } from '@/app/lib/server/streamLimit';

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
 *
 * @param signal 呼び出し元の中断。ストリーム中継と同じく、依頼主が居なくなったら Caster も畳む
 */
function fetchSourceTable(
  address: string,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    /** 完了時に中断の購読を外す。終わった取得のリスナーを signal へ残さない */
    let detachAbort = (): void => {};

    const connection = openCasterSocket({
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
      onEnd: () => {
        detachAbort();
        resolve(Buffer.concat(chunks).toString('utf8'));
      },
      onFailure: (error) => {
        detachAbort();
        reject(error);
      },
    });

    // 依頼主が離脱したら Caster への接続も畳む。宛先の居ない応答を最大 4 MB 受け取り続けても、
    // ソケットと同時実行スロットを無駄に握るだけなので
    const abort = () => {
      connection.close();
      reject(new NtripRequestError('配信局一覧の取得が中断されました。'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    detachAbort = () => signal.removeEventListener('abort', abort);
  });
}

export async function GET(request: NextRequest) {
  // この GET はカスタムヘッダを持たずプリフライトが飛ばないため、
  // 外部サイトが訪問者のブラウザから呼び出せてしまう。関門はストリーム側と同じ順に並べ、
  // まず呼び出し元を確かめる（入力の当否で 400 と 403 を返し分けない）
  try {
    assertSameOrigin(request.headers);
  } catch (error) {
    return toNtripErrorResponse(error, 'Source-tableの取得に失敗しました。');
  }

  const searchParams = request.nextUrl.searchParams;
  const host = searchParams.get('host') || DEFAULT_NTRIP_HOST;
  const port = Number.parseInt(searchParams.get('port') || String(DEFAULT_NTRIP_PORT), 10);

  if (!isValidPort(port)) {
    return NextResponse.json({ error: '無効なポート番号です。' }, { status: 400 });
  }

  // 1 リクエストにつき TCP 1 本と最大 4 MB のバッファを最長 8 秒抱えるため、
  // 同時に走る本数を抑える
  const releaseSlot = acquireSourceTableSlot();
  if (!releaseSlot) {
    return NextResponse.json(
      { error: '配信局一覧の取得が混み合っています。しばらく待って再試行してください。' },
      { status: 503 },
    );
  }

  try {
    const target = await resolveSafeTarget(host);
    // 検査を通した正規化済みのホスト名を名乗る
    const rawData = await fetchSourceTable(target.address, target.hostname, port, request.signal);
    const records = parseSourceTable(rawData);
    // 画面が読まない列は載せない。rtk2go のように配信局が 1 万件規模の Caster では、
    // 全 17 列をそのまま返すと応答が数 MB になり、その解析だけでブラウザが止まる
    return NextResponse.json({
      host: target.hostname,
      port,
      count: records.length,
      records: records.map(toMountpointSummary),
    });
  } catch (error) {
    return toNtripErrorResponse(error, 'Source-tableの取得に失敗しました。');
  } finally {
    releaseSlot();
  }
}
