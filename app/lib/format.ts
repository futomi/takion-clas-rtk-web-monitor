/**
 * 画面表示用の値整形をまとめたモジュール。
 * 単位付き数値・16 進表記・経過時間など、複数のパネルで書式を揃えたいものだけを置く。
 */

/** 数値を固定小数で描画する。未取得なら em ダッシュを返す */
export function formatValue(value: number | undefined, digits = 2, suffix = ''): string {
  return value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`;
}

/** バイト数を KB 表記で描画する。受信量の表示に使う */
export function formatKilobytes(bytes: number, digits = 1): string {
  return `${(bytes / 1024).toFixed(digits)} KB`;
}

/** USB の VID / PID を 0xXXXX 形式で描画する */
export function formatHex(value: number | undefined): string {
  return value === undefined ? '—' : `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 経過秒数を「N秒前」形式で描画する */
export function formatSecondsAgo(timestamp: number | null | undefined, now: number): string {
  if (timestamp === null || timestamp === undefined) return '—';
  return `${Math.max(0, Math.floor((now - timestamp) / 1000))}秒前`;
}

/** 受信時刻を 24 時間表記の時:分:秒に整形する */
export function formatLogTime(receivedAt: number): string {
  return new Date(receivedAt).toLocaleTimeString('ja-JP', { hour12: false });
}
