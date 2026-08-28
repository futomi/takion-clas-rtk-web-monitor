/**
 * 利用者にそのまま提示してよいエラー。
 *
 * タイムアウトや受信上限の超過など、こちらが意図して投げたものだけをこの型で表す。
 * 素の socket エラー（`ECONNREFUSED …` など、内部構成が透ける文言）と区別するために使う。
 *
 * HTTP 応答への変換は {@link ./apiError} が行う。ここを `next/server` から切り離しておくと、
 * 中継処理そのものを Node の素のテストランナーから動かせる。
 */
export class NtripRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NtripRequestError';
  }
}

/**
 * 受け入れ余力が無いことを表す。
 *
 * 入力にも上流にも非はなく、こちら側が同時実行の枠を使い切っているだけなので、
 * 障害（502）とは区別して 503 として返す。変換は {@link ./apiError} が行う。
 */
export class NtripBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NtripBusyError';
  }
}
