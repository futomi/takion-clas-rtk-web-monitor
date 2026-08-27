import { normalizeStoredPoint, type TrackPoint } from './track';

/**
 * 記録中の軌跡を IndexedDB へ逐次保存するための入出力。
 *
 * 同時に扱う軌跡は 1 本だけなので、記録を始めるたびにストアを空にする方式にしている。
 * localStorage ではなく IndexedDB を使うのは、1 秒間隔で数時間ぶんの点を貯めると
 * localStorage の容量ではすぐ足りなくなるため。
 */

const DB_NAME = 'takion_track';
const DB_VERSION = 1;
const META_STORE = 'meta';
const POINT_STORE = 'points';
/** meta ストアに置く唯一のレコードのキー */
const META_KEY = 'current';

export type TrackStatus = 'recording' | 'stopped';

/** 記録中の軌跡そのものに関する情報。点の並びとは別に 1 件だけ持つ */
export type TrackMeta = {
  startedAt: number;
  intervalMs: number;
  status: TrackStatus;
};

/** 保存されていた軌跡 */
export type RestoredTrack = {
  meta: TrackMeta;
  points: TrackPoint[];
};

/** この環境で IndexedDB を使えるか。プライベートモードなどでは使えないことがある */
export function isTrackStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!isTrackStoreAvailable()) return Promise.reject(new Error('この環境では IndexedDB を利用できません。'));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      // 点は挿入順に読み出せればよいので、キーは自動採番の外部キーで足りる
      if (!db.objectStoreNames.contains(POINT_STORE)) db.createObjectStore(POINT_STORE, { autoIncrement: true });
    };
    request.onsuccess = () => {
      const db = request.result;
      // 開いた接続はタブが閉じるまで握り続ける。他のタブがスキーマを更新しようとしたとき、
      // こちらが閉じないと相手が待たされ続けるため、要求が来たら道を空ける
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けませんでした。'));
  });
  // 失敗した接続を握り続けると次回以降も同じ失敗を返してしまう
  return dbPromise.catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
}

/** リクエスト 1 件の完了を待つ */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の操作に失敗しました。'));
  });
}

/**
 * トランザクション全体の完了を待つ。
 * 個々のリクエストの成功だけでは書き込みが確定していないため、必ずこちらを待つ。
 */
function whenComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB の書き込みが中断されました。'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB の書き込みに失敗しました。'));
  });
}

/** 新しい記録を始める。前回の軌跡は破棄する */
export async function beginStoredTrack(meta: TrackMeta): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([META_STORE, POINT_STORE], 'readwrite');
  transaction.objectStore(POINT_STORE).clear();
  transaction.objectStore(META_STORE).put(meta, META_KEY);
  await whenComplete(transaction);
}

/**
 * 点をまとめて追記する。
 * 点ごとにトランザクションを開くと 1 秒に何度も IndexedDB を叩くことになるため、
 * 呼び出し側でバッファしてからここへ渡す。
 */
export async function appendStoredPoints(points: TrackPoint[]): Promise<void> {
  if (points.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(POINT_STORE, 'readwrite');
  const store = transaction.objectStore(POINT_STORE);
  for (const point of points) store.add(point);
  await whenComplete(transaction);
}

/**
 * 1 つのストアから 1 件読む。
 *
 * 読み取りと書き込みで別のトランザクションを張るのは、await をまたいだ時点で
 * トランザクションが確定してしまい、続きの操作が失敗し得るため。
 * 軌跡はこのタブしか書かないので、分けても競合しない。
 */
async function readOne(storeName: string, key: string): Promise<unknown> {
  const db = await openDatabase();
  return toPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key) as IDBRequest<unknown>);
}

/** 記録の状態だけを書き換える。点はそのまま残す */
export async function updateStoredTrackStatus(status: TrackStatus): Promise<void> {
  const meta = normalizeMeta(await readOne(META_STORE, META_KEY));
  if (!meta) return;
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({ ...meta, status }, META_KEY);
  await whenComplete(transaction);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 保存されていた meta を読み戻す。欠けている項目があれば復元しない */
function normalizeMeta(value: unknown): TrackMeta | null {
  if (!isRecord(value)) return null;
  const { startedAt, intervalMs, status } = value;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return {
    startedAt,
    intervalMs: typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : 1000,
    status: status === 'recording' ? 'recording' : 'stopped',
  };
}

/**
 * 保存されている軌跡を読み出す。無ければ null。
 *
 * 壊れたレコードは個別に読み捨てる。1 点の破損で復元全体を諦めるより、
 * 読める点だけでも返したほうが記録の価値が残るため。
 */
export async function loadStoredTrack(): Promise<RestoredTrack | null> {
  const meta = normalizeMeta(await readOne(META_STORE, META_KEY));
  if (!meta) return null;

  const db = await openDatabase();
  const rawPoints = await toPromise(
    db.transaction(POINT_STORE, 'readonly').objectStore(POINT_STORE).getAll() as IDBRequest<unknown[]>,
  );
  const points = rawPoints
    .map(normalizeStoredPoint)
    .filter((point): point is TrackPoint => point !== null);
  return { meta, points };
}

/** 保存されている軌跡を消す */
export async function clearStoredTrack(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([META_STORE, POINT_STORE], 'readwrite');
  transaction.objectStore(META_STORE).clear();
  transaction.objectStore(POINT_STORE).clear();
  await whenComplete(transaction);
}
