import { NtripRequestError } from './ntripError';

/**
 * Source-table 取得の結果を一定時間だけ持ち回す。
 *
 * 配信局の一覧は、そこそこの大きさがある割に中身がほとんど変わらない
 * （rtk2go の実測で 694 局・109 KB。変わるのは配信局が増減したときだけ）。
 * 画面を開くたびに取り直すのは、Caster にとっても自分の帯域にとっても無駄が大きい。
 * 公開環境では利用者ぶんの取得がすべて 1 つの IP から出ていくため、
 * 叩きすぎた側が接続を拒否される事態にもつながる。
 *
 * あわせて、同じ宛先への取得が重なった場合は 1 本にまとめる。控えが切れた直後に
 * 依頼が揃うと、そのぶんだけ Caster を叩きに行ってしまうため。
 *
 * 置き場はプロセス内のメモリなので、複数インスタンスへ広げた場合はインスタンスごとに持つ。
 * 台数ぶんは取得が走るが、それでも「画面を開くたび」からは桁で減る。
 */

/** 控えを保つ既定の長さ（秒） */
const DEFAULT_CACHE_SECONDS = 600;

/**
 * 同時に抱える宛先の数。
 *
 * 1 件の大きさは Caster 次第で、受信を打ち切る上限（4 MB）ぶんまで膨らみ得る。
 * 宛先を変えて叩かれ続けてもメモリが際限なく伸びないよう、件数で頭を押さえておく。
 */
const MAX_ENTRIES = 4;

type CacheEntry = {
  /** 組み立て済みの応答本文。応答のたびに直列化し直さないよう、この形で持つ */
  body: string;
  /** この時刻を過ぎたら取り直す */
  expiresAt: number;
};

/** 宛先ごとの控え。Map の挿入順を古い順として使い、上限に達したら先頭から落とす */
const entries = new Map<string, CacheEntry>();

/**
 * 控えを保つ長さ（ms）。`0` を指定するとキャッシュを止められる。
 *
 * 起動時に一度読むのではなく都度読むのは、{@link ./streamLimit} の上限値と同じ理由による。
 */
function cacheDurationMs(): number {
  const parsed = Number.parseInt(process.env.NTRIP_SOURCETABLE_CACHE_SECONDS ?? '', 10);
  const seconds = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_SECONDS;
  return seconds * 1000;
}

/** 期限内の控えがあれば応答本文を返す。無ければ `null` */
export function readSourceTableCache(key: string): string | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry.body;
}

/** 取得結果を控えへ収める。期限切れを落としてから上限を測る */
function writeSourceTableCache(key: string, body: string): void {
  const duration = cacheDurationMs();
  if (duration <= 0) return;

  const now = Date.now();
  for (const [existingKey, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(existingKey);
  }
  // 入れ直しでも挿入順を最新へ更新したいので、一度消してから積む
  entries.delete(key);
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }

  entries.set(key, { body, expiresAt: now + duration });
}

/**
 * 実行中の取得。
 *
 * 結果は成否どちらも「値」として畳んで持つ。待ち手が全員離れた後に拒否されたとき、
 * 誰も受け取らない rejection が残らないようにするため。
 */
type FlightOutcome = { body: string } | { error: unknown };

type Flight = {
  /** 待ち手が見る結果 */
  outcome: Promise<FlightOutcome>;
  /** 上流を畳むための中断。待ち手が全員居なくなったときだけ引く */
  controller: AbortController;
  /** まだ結果を待っている依頼の数 */
  waiting: number;
  /** 取得が終わっているか。終わった取得へ中断を投げないための目印 */
  settled: boolean;
};

const flights = new Map<string, Flight>();

/**
 * 同じ宛先への取得を 1 本にまとめて実行し、結果を控えへ収める。
 *
 * 実行を始める前にもう一度控えを見るのは、呼び出し元が空振りを確かめてから
 * ここへ来るまでの間に、別の依頼が結果を入れている場合があるため。
 *
 * @param load 実際に Caster から取得して応答本文を組み立てる処理
 * @param signal 呼び出し元の中断
 */
export function loadSourceTable(
  key: string,
  load: (signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
): Promise<{ body: string; fromCache: boolean }> {
  const cached = readSourceTableCache(key);
  if (cached !== null) return Promise.resolve({ body: cached, fromCache: true });

  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: Flight = { controller, waiting: 0, settled: false, outcome: Promise.resolve({ error: null }) };

    created.outcome = load(controller.signal)
      .then(
        (body): FlightOutcome => {
          created.settled = true;
          writeSourceTableCache(key, body);
          return { body };
        },
        (error): FlightOutcome => {
          created.settled = true;
          return { error };
        },
      )
      .finally(() => {
        // 自分がまだ現役の取得である場合だけ片付ける。
        // 取り違えて、後から始まった取得を消してしまわないため
        if (flights.get(key) === created) flights.delete(key);
      });

    flights.set(key, created);
    flight = created;
  }

  return waitForFlight(flight, signal);
}

/**
 * 実行中の取得へ相乗りする。
 *
 * 待ち手は自分の中断でいつでも降りられるが、上流の接続を畳むのは全員が降りたときだけ。
 * 先に依頼した 1 人が離脱しただけで、後から相乗りした依頼まで巻き添えにしないため。
 */
function waitForFlight(flight: Flight, signal: AbortSignal): Promise<{ body: string; fromCache: boolean }> {
  flight.waiting += 1;

  return new Promise((resolve, reject) => {
    let left = false;

    const leave = () => {
      if (left) return;
      left = true;
      signal.removeEventListener('abort', onAbort);
      flight.waiting -= 1;
      // 宛先の居ない受信を続けても、ソケットと同時実行スロットを無駄に握るだけ
      if (!flight.settled && flight.waiting <= 0) flight.controller.abort();
    };

    const onAbort = () => {
      leave();
      reject(new NtripRequestError('配信局一覧の取得が中断されました。'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    void flight.outcome.then((outcome) => {
      if (left) return;
      leave();
      if ('body' in outcome) resolve({ body: outcome.body, fromCache: false });
      else reject(outcome.error);
    });
  });
}

/** 控えている宛先の数。監視とテストのために公開する */
export function sourceTableCacheSize(): number {
  return entries.size;
}

/** 控えをすべて捨てる。テストが状態を持ち越さないために使う */
export function clearSourceTableCache(): void {
  entries.clear();
}
