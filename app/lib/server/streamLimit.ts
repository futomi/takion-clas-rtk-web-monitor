/**
 * NTRIP 中継の同時実行数を制限する。
 *
 * `/api/ntrip/*` はいずれも認証を要求せず、1 リクエストにつき Caster への TCP 接続を開く。
 * 制限が無いと、繰り返し叩かれるだけでプロセスのソケットとメモリを食い潰せてしまう。
 * 公開デプロイでは前段のレート制限が本命だが、それが無い場合の最後の歯止めとして
 * プロセス内の同時本数だけは必ず抑えておく。
 *
 * ストリーム中継（長寿命・低レート）と Source-table 取得（短寿命・最大 4 MB）は
 * 寿命も適切な上限値も違うため、枠を分けて数える。片方が埋まっても他方は受け付けられる。
 */

/** 既定の同時実行上限。個人利用なら 1 本、家族や小規模チームでも数本で足りる */
const DEFAULT_MAX_CONCURRENT = 4;

/** 同時実行の枠 1 つ分 */
type SlotPool = {
  /**
   * スロットを 1 つ確保する。空きが無ければ `null`。
   * 戻り値の解放関数は、経路が分かれても取りこぼさないよう何度呼んでもよい。
   */
  acquire: () => (() => void) | null;
  /** 確保中のスロット数。監視とテストのために公開する */
  active: () => number;
};

/**
 * 同時実行の枠を 1 つ作る。
 *
 * 上限を起動時に一度読むのではなく確保のたびに読むのは、テストから差し替えられるようにするため。
 * 呼ばれるのは接続開始時だけなので、読み直しの負荷は問題にならない。
 */
function createSlotPool(envName: string): SlotPool {
  let activeSlots = 0;

  const limit = (): number => {
    const parsed = Number.parseInt(process.env[envName] ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT;
  };

  return {
    acquire: () => {
      if (activeSlots >= limit()) return null;
      activeSlots += 1;

      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeSlots -= 1;
      };
    },
    active: () => activeSlots,
  };
}

const streamPool = createSlotPool('NTRIP_MAX_CONCURRENT_STREAMS');
const sourceTablePool = createSlotPool('NTRIP_MAX_CONCURRENT_SOURCETABLES');

/** RTCM 中継のスロットを 1 つ確保する。空きが無ければ `null` */
export const acquireStreamSlot = streamPool.acquire;
/** 確保中の RTCM 中継スロット数 */
export const activeStreamCount = streamPool.active;

/** Source-table 取得のスロットを 1 つ確保する。空きが無ければ `null` */
export const acquireSourceTableSlot = sourceTablePool.acquire;
/** 確保中の Source-table 取得スロット数 */
export const activeSourceTableCount = sourceTablePool.active;
