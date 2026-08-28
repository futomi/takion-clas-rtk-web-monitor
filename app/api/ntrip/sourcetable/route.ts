import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_NTRIP_HOST,
  DEFAULT_NTRIP_PORT,
  isValidPort,
  parseSourceTable,
  toMountpointSummary,
  type SourceTableResponse,
} from '@/app/lib/ntrip';
import { buildSourceTableRequest } from '@/app/lib/ntripHeader';
import { NtripBusyError, NtripRequestError, toNtripErrorResponse } from '@/app/lib/server/apiError';
import { openCasterSocket } from '@/app/lib/server/casterSocket';
import { resolveSafeTarget, type ResolvedTarget } from '@/app/lib/server/hostGuard';
import { assertSameOrigin } from '@/app/lib/server/originGuard';
import { loadSourceTable, readSourceTableCache } from '@/app/lib/server/sourceTableCache';
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

/**
 * Caster から取得し、そのまま返せる JSON 本文へ組み立てる。
 *
 * 画面が読まない列は載せない。全 17 列をそのまま返すと、配信局を多く抱える Caster では
 * 応答がそのぶん膨らみ、ブラウザ側の解析も重くなる（rtk2go の実測で 109 KB → 68 KB）。
 *
 * 直列化まで済ませた文字列を返すのは、これが {@link @/app/lib/server/sourceTableCache} の
 * 控える単位だから。控えを返すときに組み立て直さずに済む。
 */
async function buildSourceTableBody(
  target: ResolvedTarget,
  port: number,
  signal: AbortSignal,
): Promise<string> {
  // 検査を通した正規化済みのホスト名を名乗る
  const rawData = await fetchSourceTable(target.address, target.hostname, port, signal);
  const records = parseSourceTable(rawData);
  const payload: SourceTableResponse = {
    host: target.hostname,
    port,
    count: records.length,
    records: records.map(toMountpointSummary),
  };
  return JSON.stringify(payload);
}

/**
 * 組み立て済みの本文をそのまま返す。
 *
 * 鮮度はサーバー側の控えで一元管理するため、ブラウザには持たせない。
 * 期限が二重になると、どちらの都合で古い一覧が出ているのか追えなくなる。
 */
function sourceTableResponse(body: string, fromCache: boolean): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Sourcetable-Cache': fromCache ? 'hit' : 'miss',
    },
  });
}

/**
 * 同時実行の枠を確保してから取得する。
 *
 * 枠が数えるのは Caster への接続 1 本ぶんなので、確保するのは実際に接続を開く
 * この取得だけでよい。相乗りしている依頼は接続もバッファも増やさないため、
 * ここで枠を求めない（求めると、待っているだけの依頼が枠を埋めてしまう）。
 */
function fetchWithSlot(target: ResolvedTarget, port: number) {
  return async (signal: AbortSignal): Promise<string> => {
    // 1 回の取得につき TCP 1 本と最大 4 MB のバッファを最長 8 秒抱えるため、
    // 同時に走る本数を抑える
    const releaseSlot = acquireSourceTableSlot();
    if (!releaseSlot) {
      throw new NtripBusyError('配信局一覧の取得が混み合っています。しばらく待って再試行してください。');
    }

    try {
      return await buildSourceTableBody(target, port, signal);
    } finally {
      releaseSlot();
    }
  };
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

  // 控えを引く前に接続先を検査する。許可リストの変更が、控えの残っている宛先にも
  // その場で効くようにするため（検査を飛ばすと、外した宛先を期限切れまで返し続ける）
  let target: ResolvedTarget;
  try {
    target = await resolveSafeTarget(host);
  } catch (error) {
    return toNtripErrorResponse(error, 'Source-tableの取得に失敗しました。');
  }

  const cacheKey = `${target.hostname}:${port}`;

  // 期限内の控えがあれば Caster へは行かない。TCP もバッファも要らないので、
  // 同時実行の枠も取らずに返す
  const cached = readSourceTableCache(cacheKey);
  if (cached !== null) return sourceTableResponse(cached, true);

  try {
    const { body, fromCache } = await loadSourceTable(cacheKey, fetchWithSlot(target, port), request.signal);
    return sourceTableResponse(body, fromCache);
  } catch (error) {
    return toNtripErrorResponse(error, 'Source-tableの取得に失敗しました。');
  }
}
