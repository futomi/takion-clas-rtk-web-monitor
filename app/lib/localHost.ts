/**
 * ホスト名がループバック——つまり「このアプリを動かしている本人のマシン」——を指すかの判定。
 *
 * サーバー側は `Host` ヘッダーから、画面側は `location.host` から、同じ述語を引く。
 * 両者が別々に判断すると「UI には出ているのに API が拒む」というずれが起きるため、
 * 判定そのものはここ 1 つに集約する。
 *
 * ホスト名を見るだけの判定なので、ブラウザ以外のクライアントからは詐称できる。
 * 遮断の根拠としてこれ単独では使わない（{@link ./server/ntripAvailability} を参照）。
 */

/** `Host` ヘッダーや `location.host` から、ポートを除いたホスト名を取り出す */
export function extractHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  // IPv6 リテラルは `[::1]:3000` の形で届く。閉じ括弧までを 1 つのホスト名として扱う
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** 127.0.0.0/8 に入る IPv4 リテラルか */
function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  return parts[0] === '127';
}

/**
 * ループバックを指すホスト名か。
 *
 * `localhost` とそのサブドメイン（`app.localhost` など）、127.0.0.0/8、`::1` を通す。
 * ブラウザが「安全なコンテキスト」として扱う範囲に合わせてある。このアプリの中核である
 * Web Serial はその外では動かないため、ここを広げてもローカル利用の役には立たない。
 */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.trim().toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name === '::1' || name === '[::1]') return true;
  return isLoopbackIpv4(name);
}

/** `Host` ヘッダーや `location.host` の値が、ループバックを指すか */
export function isLoopbackHost(host: string): boolean {
  return isLoopbackHostname(extractHostname(host));
}
