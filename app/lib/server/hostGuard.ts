import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { MAX_HOSTNAME_LENGTH } from '../ntripHeader';

/**
 * 外部ホストへの接続を許可してよいかを判定する。
 *
 * このアプリの API ルートは、クライアントから渡されたホスト名へサーバー側から TCP 接続する。
 * 無検証だと、公開デプロイ時にサーバーを踏み台にして内部ネットワークやクラウドの
 * メタデータエンドポイントへ到達できてしまう（SSRF）。
 *
 * そこで名前解決の結果を検査し、プライベート／ループバック／リンクローカル宛だった場合は拒否する。
 * さらに、解決済みの IP をそのまま接続先として返すことで、検査後に別の IP を返す
 * DNS リバインディングも封じている。
 */

/**
 * ホスト名として受け付ける形。英数字・ハイフン・ドット・コロン（IPv6 リテラル）のみ。
 *
 * 解決結果の検査とは別に、文字種の時点で弾いておく。ここを通した文字列は
 * `Host` ヘッダへそのまま載るため、CR / LF や空白が混ざると
 * リクエストを分割される（{@link ../ntripHeader} の検査と二重に守る）。
 */
const HOSTNAME_PATTERN = /^[a-z0-9.\-:[\]]+$/;

/** 接続を拒否する IP レンジ */
const BLOCKED = new BlockList();
// IPv4
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4'); // 現ネットワーク
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4'); // プライベート
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4'); // ループバック
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4'); // リンクローカル（クラウドのメタデータ含む）
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4'); // プライベート
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF プロトコル割当
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4'); // プライベート
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4'); // ベンチマーク
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4'); // マルチキャスト
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4'); // 予約
// IPv6
BLOCKED.addSubnet('::', 128, 'ipv6'); // 未指定
BLOCKED.addSubnet('::1', 128, 'ipv6'); // ループバック
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // ユニークローカル
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // リンクローカル
BLOCKED.addSubnet('ff00::', 8, 'ipv6'); // マルチキャスト

/**
 * IPv4 射影 IPv6 アドレス（`::ffff:127.0.0.1` など）を素の IPv4 表記へ直す。
 *
 * これを踏まないと、射影表記を使うだけで IPv4 のブロック規則を迂回できてしまう。
 * 逆に `::ffff:0:0/96` をまとめてブロックすると、Node の BlockList は素の IPv4 も
 * 射影表記として正規化するため、すべての IPv4 宛が拒否されてしまう点にも注意。
 */
function normalizeAddress(address: string, family: 4 | 6, hostname: string): ResolvedTarget {
  if (family !== 6) return { address, family, hostname };
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  if (mapped && isIP(mapped[1]) === 4) return { address: mapped[1], family: 4, hostname };
  return { address, family, hostname };
}

/** 検証済みの接続先 */
export type ResolvedTarget = {
  /** 実際に接続すべき IP アドレス */
  address: string;
  family: 4 | 6;
  /**
   * 正規化済みのホスト名。`Host` ヘッダにはこちらを使う。
   *
   * 検査したのは正規化後の文字列なので、リクエストへ載せる値も同じものに揃えないと、
   * 「検査したホスト」と「名乗るホスト」がずれてしまう。
   */
  hostname: string;
};

export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedHostError';
  }
}

/**
 * `NTRIP_ALLOWED_HOSTS` が設定されている場合は、そこに列挙されたホストのみを許可する。
 * 未設定なら「プライベート宛でなければ許可」という既定方針で動く。
 */
function readAllowList(): string[] | null {
  const raw = process.env.NTRIP_ALLOWED_HOSTS?.trim();
  if (!raw) return null;
  return raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

/**
 * ホスト名を解決し、接続してよい相手かを検証する。
 * 問題があれば {@link BlockedHostError} を投げる。
 */
export async function resolveSafeTarget(host: string): Promise<ResolvedTarget> {
  const normalized = host.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_HOSTNAME_LENGTH || !HOSTNAME_PATTERN.test(normalized)) {
    throw new BlockedHostError('ホスト名が不正です。');
  }

  const allowList = readAllowList();
  if (allowList && !allowList.includes(normalized)) {
    throw new BlockedHostError('このホストへの接続は許可されていません。');
  }

  // IP リテラルならそのまま検査、ホスト名なら名前解決してから検査する
  const literalFamily = isIP(normalized);
  const candidates: ResolvedTarget[] = literalFamily
    ? [normalizeAddress(normalized, literalFamily as 4 | 6, normalized)]
    : (await lookupOrThrow(normalized));

  for (const candidate of candidates) {
    if (BLOCKED.check(candidate.address, candidate.family === 4 ? 'ipv4' : 'ipv6')) {
      throw new BlockedHostError('プライベートネットワーク宛の接続は許可されていません。');
    }
  }

  const target = candidates[0];
  if (!target) throw new BlockedHostError('ホスト名を解決できませんでした。');
  return target;
}

async function lookupOrThrow(host: string): Promise<ResolvedTarget[]> {
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.map((entry) => normalizeAddress(entry.address, entry.family as 4 | 6, host));
  } catch {
    throw new BlockedHostError('ホスト名を解決できませんでした。');
  }
}
