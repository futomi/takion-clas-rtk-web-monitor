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
 * ヘッダ終端がまだ来ていない場合の返り値。
 *
 * 上限判定をここへ集約するのは、終端を送らない相手を分岐の中で `pending` として返すと
 * 呼び出し側のバッファが際限なく伸びてしまうため。上限は「まだ待つ」と答える直前にだけ
 * 効かせる。関数の冒頭で長さだけを見て弾くと、正しいヘッダと本文の先頭が
 * 同じチャンクで届いた場合まで異常として扱ってしまう。
 */
function pendingWithinLimit(buffer: Uint8Array): NtripHeaderResult {
  if (buffer.length > MAX_HEADER_BYTES) {
    return { status: 'error', message: 'NTRIP Casterの応答ヘッダが不正です。' };
  }
  return { status: 'pending' };
}

/** 画面へ返す Caster のステータス行の最大長。相手由来の文言をそのまま垂れ流さない */
const MAX_STATUS_LINE_CHARS = 200;

/** ステータス行をエラー文言として提示できる長さへ丸める */
function describeStatusLine(statusLine: string): string {
  const trimmed = statusLine.trim();
  return trimmed.length > MAX_STATUS_LINE_CHARS ? `${trimmed.slice(0, MAX_STATUS_LINE_CHARS)}…` : trimmed;
}

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
    if (crlfIndex === -1) return pendingWithinLimit(buffer);
    return { status: 'ok', bodyOffset: crlfIndex + CRLF.length };
  }

  const headerEnd = indexOfSequence(buffer, CRLF_CRLF);
  if (headerEnd !== -1) {
    const statusLine = ASCII.decode(buffer.subarray(0, crlfIndex === -1 ? headerEnd : crlfIndex));
    if (!isSuccessStatus(statusLine)) {
      return { status: 'error', message: `NTRIP Casterエラー: ${describeStatusLine(statusLine)}` };
    }
    return { status: 'ok', bodyOffset: headerEnd + CRLF_CRLF.length };
  }

  // ステータス行だけ読めた時点で失敗が確定するなら、本文を待たずに打ち切る
  if (crlfIndex !== -1 && upperPreview.startsWith('HTTP/')) {
    const statusLine = ASCII.decode(buffer.subarray(0, crlfIndex));
    if (!isSuccessStatus(statusLine)) {
      return { status: 'error', message: `NTRIP Casterエラー: ${describeStatusLine(statusLine)}` };
    }
  }

  return pendingWithinLimit(buffer);
}

/**
 * 本アプリが名乗る User-Agent。
 * NTRIP のクライアントは `NTRIP ` で始まる名前を送るのが仕様上の慣例で、
 * これを見てクライアント種別を判定する Caster があるため、Source-table 取得時も同じ名前を使う。
 */
const USER_AGENT = 'NTRIP TakionCLAS-RTK-WebMonitor/1.0';

/** 利用者に提示してよい、入力値そのものの不備 */
export class NtripParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NtripParameterError';
  }
}

/**
 * リクエスト行とヘッダ値へ埋め込めない文字。印字可能 ASCII 以外をすべて拒む。
 *
 * マウントポイント名とホスト名は利用者の入力がそのまま HTTP リクエスト文字列になる。
 * CR / LF を通すと 1 本の GET を任意個のリクエストへ分割でき（リクエストスプリッティング）、
 * SSRF 検査を通過したホストに対して任意のバイト列を送り込む踏み台にされてしまう。
 * 空白もリクエスト行の区切りとして解釈されるため、まとめて弾く。
 */
const NON_EMBEDDABLE = /[^!-~]/;

/**
 * 入力値ごとの最大長。
 *
 * 文字種だけを見て長さを見ないと、巨大なマウントポイント名や認証情報を送るだけで
 * サーバーに数 MB のリクエストを第三者の Caster へ送らせられる（増幅の踏み台）。
 * 実在する値はいずれもこの上限より遥かに短い。
 */
export const MAX_MOUNTPOINT_LENGTH = 128;
/** 認証情報の最大長。Base64 を通るため文字種は問わないが、長さだけは抑える */
export const MAX_CREDENTIAL_LENGTH = 256;
/** ホスト名の最大長。DNS 名の上限に合わせる（{@link ../server/hostGuard} と同じ値） */
export const MAX_HOSTNAME_LENGTH = 253;

/** 長さの上限だけを確かめる。危険なら {@link NtripParameterError} を投げる */
function assertLength(value: string, label: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw new NtripParameterError(`${label}が長すぎます（${maxLength}文字以内で指定してください）。`);
  }
}

/** リクエストへ埋め込んで安全な値かを確かめる。危険なら {@link NtripParameterError} を投げる */
export function assertEmbeddable(value: string, label: string, maxLength: number): void {
  assertLength(value, label, maxLength);
  if (NON_EMBEDDABLE.test(value)) {
    throw new NtripParameterError(`${label}に使用できない文字が含まれています。`);
  }
}

/** NTRIP Caster へ送る GET リクエストを組み立てる */
function buildHttpGetRequest(path: string, host: string, extraHeaders: string[] = []): string {
  // 組み立て経路が増えても検査漏れが起きないよう、最後の関門をここに置く。
  // パスは先頭の `/` のぶんだけマウントポイント名より 1 文字長い
  assertEmbeddable(path, 'リクエストパス', MAX_MOUNTPOINT_LENGTH + 1);
  assertEmbeddable(host, 'ホスト名', MAX_HOSTNAME_LENGTH);
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
  assertEmbeddable(mountpoint, 'マウントポイント名', MAX_MOUNTPOINT_LENGTH);
  // 認証情報は Base64 へ通すため、どんな文字を含んでいてもヘッダの外へは出られない。
  // 空白を含むパスワードも受け付けたいので、文字種は制限せず長さだけを抑える。
  assertLength(username, 'ユーザー名', MAX_CREDENTIAL_LENGTH);
  assertLength(password, 'パスワード', MAX_CREDENTIAL_LENGTH);
  const credentials = username || password
    ? [`Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`]
    : [];
  return buildHttpGetRequest(`/${mountpoint}`, host, credentials);
}

/** 配信局一覧（Source-table）を要求する GET を組み立てる。認証は不要 */
export function buildSourceTableRequest(host: string): string {
  return buildHttpGetRequest('/', host);
}
