/**
 * NTRIP Caster のレスポンスヘッダ解析。
 *
 * Caster は実装によって 3 通りの応答を返す:
 *   - NTRIP 1.0: `ICY 200 OK\r\n` の直後からバイナリが始まる（空行なし）
 *   - NTRIP 2.0 / HTTP: `HTTP/1.1 200 OK\r\n...\r\n\r\n` の後に本文
 *   - マウントポイント不在: Source-table を返す（`SOURCETABLE 200 OK`）
 *
 * ソケットのデータハンドラから切り離した純粋関数として扱えるよう、
 * 受信済みバイト列だけを見て判定する。
 */

/** ヘッダ判定に覗く先頭バイト数 */
const PREVIEW_BYTES = 128;

/** ヘッダとして受け入れる最大バイト数。終端が来ない相手でバッファが伸び続けるのを防ぐ */
export const MAX_HEADER_BYTES = 8192;

export type NtripHeaderResult =
  /** まだヘッダ終端に達していない。次のチャンクを待つ */
  | { status: 'pending' }
  /** ヘッダを読み切った。`bodyOffset` 以降が RTCM 本文 */
  | { status: 'ok'; bodyOffset: number }
  /** Caster がエラーを返した、またはヘッダが異常 */
  | { status: 'error'; message: string };

const ASCII = new TextDecoder('ascii');

/** バイト列から部分列の開始位置を探す */
function indexOfSequence(haystack: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const CRLF = [0x0d, 0x0a];
const CRLF_CRLF = [0x0d, 0x0a, 0x0d, 0x0a];

/**
 * ステータス行が成功を示しているか。
 *
 * `ICY 200 OK` / `HTTP/1.1 200 OK` のどちらもプロトコル表記の次が 3 桁のコードなので、
 * そこを数値として読む。行全体に '200' や 'OK' が含まれるかで判定すると、
 * 理由句にたまたまそれらを含む失敗応答を成功と取り違える。
 */
function isSuccessStatus(statusLine: string): boolean {
  const match = /^\S+\s+(\d{3})\b/.exec(statusLine.trim());
  if (!match) return false;
  const code = Number(match[1]);
  return code >= 200 && code < 300;
}

/**
 * 受信済みバイト列からヘッダの終端と成否を判定する。
 *
 * 呼び出し側は `pending` の間チャンクを連結して再度渡し、
 * `ok` を受け取ったら `bodyOffset` 以降を本文として扱えばよい。
 */
export function parseNtripResponseHeader(buffer: Uint8Array): NtripHeaderResult {
  if (buffer.length === 0) return { status: 'pending' };

  const preview = ASCII.decode(buffer.subarray(0, Math.min(PREVIEW_BYTES, buffer.length)));
  const upperPreview = preview.toUpperCase();
  const crlfIndex = indexOfSequence(buffer, CRLF);

  // マウントポイントが存在しない場合、Caster は Source-table を返す。
  // ステータス行に 200 を含むため、これを成功と誤認しないよう先に弾く。
  if (upperPreview.startsWith('SOURCETABLE')) {
    return {
      status: 'error',
      message: 'マウントポイントが見つかりません。配信局名を確認してください。',
    };
  }

  // NTRIP 1.0 は改行 1 回でヘッダが終わり、直後からバイナリが流れる
  if (upperPreview.startsWith('ICY 200')) {
    if (crlfIndex === -1) return { status: 'pending' };
    return { status: 'ok', bodyOffset: crlfIndex + CRLF.length };
  }

  const headerEnd = indexOfSequence(buffer, CRLF_CRLF);
  if (headerEnd !== -1) {
    const statusLine = ASCII.decode(buffer.subarray(0, crlfIndex === -1 ? headerEnd : crlfIndex));
    if (!isSuccessStatus(statusLine)) {
      return { status: 'error', message: `NTRIP Casterエラー: ${statusLine}` };
    }
    return { status: 'ok', bodyOffset: headerEnd + CRLF_CRLF.length };
  }

  // ステータス行だけ読めた時点で失敗が確定するなら、本文を待たずに打ち切る
  if (crlfIndex !== -1 && upperPreview.startsWith('HTTP/')) {
    const statusLine = ASCII.decode(buffer.subarray(0, crlfIndex));
    if (!isSuccessStatus(statusLine)) {
      return { status: 'error', message: `NTRIP Casterエラー: ${statusLine}` };
    }
  }

  if (buffer.length > MAX_HEADER_BYTES) {
    return { status: 'error', message: 'NTRIP Casterの応答ヘッダが不正です。' };
  }

  return { status: 'pending' };
}

/**
 * 本アプリが名乗る User-Agent。
 * NTRIP のクライアントは `NTRIP ` で始まる名前を送るのが仕様上の慣例で、
 * これを見てクライアント種別を判定する Caster があるため、Source-table 取得時も同じ名前を使う。
 */
const USER_AGENT = 'NTRIP TakionCLAS-RTK-WebMonitor/1.0';

/** NTRIP Caster へ送る GET リクエストを組み立てる */
function buildHttpGetRequest(path: string, host: string, extraHeaders: string[] = []): string {
  return [
    `GET ${path} HTTP/1.0`,
    `Host: ${host}`,
    `User-Agent: ${USER_AGENT}`,
    'Accept: */*',
    ...extraHeaders,
    'Connection: close',
    '',
    '',
  ].join('\r\n');
}

/** マウントポイントの RTCM ストリームを要求する GET を組み立てる */
export function buildNtripStreamRequest(
  mountpoint: string,
  host: string,
  username: string,
  password: string,
): string {
  const credentials = username || password
    ? [`Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`]
    : [];
  return buildHttpGetRequest(`/${mountpoint}`, host, credentials);
}

/** 配信局一覧（Source-table）を要求する GET を組み立てる。認証は不要 */
export function buildSourceTableRequest(host: string): string {
  return buildHttpGetRequest('/', host);
}
