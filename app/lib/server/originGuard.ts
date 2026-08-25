/**
 * ブラウザからの越境呼び出しを拒否する。
 *
 * `/api/ntrip/*` は認証を要求せず、指定されたホストへサーバー側から TCP 接続する。
 * `/api/ntrip/stream` は `Content-Type: application/json` の POST なので、ブラウザの
 * プリフライトが越境呼び出しを阻む。しかし Source-table 取得はカスタムヘッダを持たない
 * 単純な GET のためプリフライトが飛ばず、外部サイトが訪問者のブラウザを使って
 * そのまま呼び出せてしまう（応答は読めないが、接続は実際に発生する）。
 *
 * そこで呼び出し元オリジンを見て、このアプリ自身のページ以外からの呼び出しを断る。
 *
 * なお curl などブラウザ以外のクライアントはこれらのヘッダを自由に詐称できるため、
 * ここでの検査は意味を持たない。判断材料が一切無い場合は通し、
 * 「ブラウザに CORS の穴を突かせない」ことだけに徹する。同時実行数の制限
 * （{@link ./streamLimit}）と接続先の制限（{@link ./hostGuard}）が別の層で受け持つ。
 */

export class ForbiddenOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenOriginError';
  }
}

/**
 * `Sec-Fetch-Site` が取り得る値のうち、受け付けてよいもの。
 *
 * - `same-origin`: 自分のページからの fetch。通常の経路
 * - `none`: URL 直打ちやブックマークなど利用者自身の操作。fetch では発生しない
 *
 * `same-site` と `cross-site` はいずれも別オリジンのページが起点なので通さない。
 * このヘッダは主要ブラウザが自動で付け、ページのスクリプトからは書き換えられない。
 */
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

const REJECTION_MESSAGE = 'このエンドポイントは外部サイトから呼び出せません。';

/** `Origin` ヘッダの示すオリジンが、リクエストを受けた自分自身かどうか */
function originMatchesHost(origin: string, host: string | null): boolean {
  if (!host) return false;
  try {
    // スキームは前段のプロキシで変わり得るため、ホスト（名前＋ポート）だけで突き合わせる
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 同一オリジンからの呼び出しであることを確かめる。
 * 越境呼び出しだった場合は {@link ForbiddenOriginError} を投げる。
 */
export function assertSameOrigin(headers: Headers): void {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase())) {
    throw new ForbiddenOriginError(REJECTION_MESSAGE);
  }

  // `Sec-Fetch-Site` を送らない古いブラウザ向けに、`Origin` でも確かめる。
  // Origin が無いのは同一オリジンの GET など珍しくない形なので、その場合は上の判定に委ねる。
  // 出所不明を表す `null` は URL として解釈できず、下の突き合わせで弾かれる
  const origin = headers.get('origin');
  if (origin !== null && !originMatchesHost(origin, headers.get('host'))) {
    throw new ForbiddenOriginError(REJECTION_MESSAGE);
  }
}
