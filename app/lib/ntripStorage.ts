import { DEFAULT_NTRIP_HOST, DEFAULT_NTRIP_PORT } from './ntrip';

const STORAGE_KEY = 'ntrip_config';

/**
 * localStorage に保存する NTRIP 設定。
 *
 * パスワードは意図的に含めない。ブラウザの localStorage は同一オリジンの
 * 任意のスクリプトから平文で読み出せるため、認証情報の保存先として適さない。
 */
export type StoredNtripConfig = {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  autoSelect: boolean;
};

export const DEFAULT_NTRIP_CONFIG: StoredNtripConfig = {
  host: DEFAULT_NTRIP_HOST,
  port: DEFAULT_NTRIP_PORT,
  mountpoint: '',
  username: '',
  autoSelect: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * 保存文字列を設定へ変換する。未保存・破損時はいずれも既定値を返す。
 * 過去のバージョンが保存したパスワードは読み捨てる。
 */
function parseStoredConfig(raw: string | null): StoredNtripConfig {
  if (!raw) return DEFAULT_NTRIP_CONFIG;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_NTRIP_CONFIG;
    return {
      host: typeof parsed.host === 'string' && parsed.host ? parsed.host : DEFAULT_NTRIP_CONFIG.host,
      port: typeof parsed.port === 'number' && Number.isFinite(parsed.port) ? parsed.port : DEFAULT_NTRIP_CONFIG.port,
      mountpoint: typeof parsed.mountpoint === 'string' ? parsed.mountpoint : DEFAULT_NTRIP_CONFIG.mountpoint,
      username: typeof parsed.username === 'string' ? parsed.username : DEFAULT_NTRIP_CONFIG.username,
      autoSelect: typeof parsed.autoSelect === 'boolean' ? parsed.autoSelect : DEFAULT_NTRIP_CONFIG.autoSelect,
    };
  } catch {
    return DEFAULT_NTRIP_CONFIG;
  }
}

/** 直近に読んだ保存文字列と、その解析結果 */
let cachedRaw: string | null = null;
let cachedConfig: StoredNtripConfig = DEFAULT_NTRIP_CONFIG;

/** localStorage が使えない環境（プライベートモード等）では未保存として扱う */
function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * 保存済み設定の変更を購読する。
 * `storage` イベントは他タブでの書き込みでのみ発火するため、同一タブの保存は通知されない
 * （書き込んだ側は自分の状態を既に持っているので、通知は不要）。
 */
export function subscribeNtripConfig(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  return () => window.removeEventListener('storage', onStoreChange);
}

/**
 * 現在の保存内容を返す。
 * 内容が変わっていない限り同じ参照を返さなければ useSyncExternalStore が再描画を繰り返すため、
 * 生の保存文字列をキーに解析結果をキャッシュする。
 */
export function getNtripConfigSnapshot(): StoredNtripConfig {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedConfig = parseStoredConfig(raw);
  }
  return cachedConfig;
}

/** サーバー描画時のスナップショット。localStorage が無いので常に既定値 */
export function getServerNtripConfigSnapshot(): StoredNtripConfig {
  return DEFAULT_NTRIP_CONFIG;
}

/** 設定を保存する。localStorage が使えない環境では黙って諦める */
export function saveNtripConfig(config: StoredNtripConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 保存できなくても動作には支障がないため無視する
  }
}
