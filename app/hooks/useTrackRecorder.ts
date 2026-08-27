'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TRACK_INTERVAL_MS, MAX_TRACK_POINTS, TRACK_FLUSH_INTERVAL_MS } from '../lib/constants';
import { shouldRecordPoint, stepDistanceMeters, summarizeTrack, toTrackPoint, type TrackPoint } from '../lib/track';
import {
  appendStoredPoints,
  beginStoredTrack,
  clearStoredTrack,
  loadStoredTrack,
  updateStoredTrackStatus,
} from '../lib/trackStore';
import type { Telemetry } from '../lib/telemetry';

/** 記録の状態。idle は 1 点も無い状態、stopped は記録済みの軌跡を抱えて止まっている状態 */
export type TrackRecorderStatus = 'idle' | 'recording' | 'stopped';

/** 画面に出す軌跡の集計値 */
export type TrackStats = {
  count: number;
  distanceMeters: number;
  startedAt: number | null;
  /** 最後に記録した点の時刻。1 点も無ければ null */
  endedAt: number | null;
};

/**
 * 位置情報の記録を受け持つフック。
 *
 * 軌跡は React の state（描画と書き出しの参照元）と IndexedDB（電源断・リロード対策）の
 * 二重で持つ。IndexedDB へは 1 点ずつではなく {@link TRACK_FLUSH_INTERVAL_MS} ごとに
 * まとめて書き出すため、最悪でもその時間ぶんだけ取りこぼす。
 */
export function useTrackRecorder(telemetry: Telemetry) {
  const [status, setStatus] = useState<TrackRecorderStatus>('idle');
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_TRACK_INTERVAL_MS);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [distanceMeters, setDistanceMeters] = useState(0);
  /** 前回の記録を読み戻したか。復帰バナーを出すかどうかの判断に使う */
  const [isRestored, setIsRestored] = useState(false);
  const [notice, setNotice] = useState('');

  // 受信ループから同期的に読むものは ref にも置く。
  // state の更新は次の描画まで反映されないため、判定にはそのまま使えない
  const pointsRef = useRef<TrackPoint[]>([]);
  const pendingRef = useRef<TrackPoint[]>([]);
  const statusRef = useRef<TrackRecorderStatus>('idle');

  const applyStatus = useCallback((next: TrackRecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const noteStorageFailure = useCallback(() => {
    setNotice('この環境では記録を保存できません。ページを離れると記録は失われます。');
  }, []);

  /** 保存側の失敗で記録そのものを止めない。書き出しは常にメモリ上の軌跡から行える */
  const persist = useCallback((task: Promise<void>) => {
    void task.catch(noteStorageFailure);
  }, [noteStorageFailure]);

  /**
   * 溜まった点を IndexedDB へ書き出す。
   * 失敗したぶんは積み直さない。保存先が壊れている状況で積み直すと
   * バッファが際限なく膨らむだけで、メモリ上の軌跡は無傷のまま残るため。
   */
  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    try {
      await appendStoredPoints(pending);
    } catch {
      noteStorageFailure();
    }
  }, [noteStorageFailure]);

  const stop = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    applyStatus('stopped');
    void flush().then(() => persist(updateStoredTrackStatus('stopped')));
  }, [applyStatus, flush, persist]);

  const start = useCallback(() => {
    const now = Date.now();
    pointsRef.current = [];
    pendingRef.current = [];
    setPoints([]);
    setDistanceMeters(0);
    setStartedAt(now);
    setIsRestored(false);
    setNotice('');
    applyStatus('recording');
    persist(beginStoredTrack({ startedAt: now, intervalMs, status: 'recording' }));
  }, [applyStatus, intervalMs, persist]);

  /** 止めた軌跡へ続きを書き足す。復元した記録の再開もこれで行う */
  const resume = useCallback(() => {
    if (statusRef.current !== 'stopped') return;
    setIsRestored(false);
    setNotice('');
    applyStatus('recording');
    persist(updateStoredTrackStatus('recording'));
  }, [applyStatus, persist]);

  const clear = useCallback(() => {
    pointsRef.current = [];
    pendingRef.current = [];
    setPoints([]);
    setDistanceMeters(0);
    setStartedAt(null);
    setIsRestored(false);
    setNotice('');
    applyStatus('idle');
    persist(clearStoredTrack());
  }, [applyStatus, persist]);

  const dismissNotice = useCallback(() => setNotice(''), []);
  const dismissRestored = useCallback(() => setIsRestored(false), []);

  // 前回の記録を読み戻す。
  // 記録中のまま落ちていても自動では再開しない。押していない操作が勝手に走ると、
  // 意図しない区間まで 1 本の軌跡として繋がってしまうため、再開はユーザーに委ねる
  useEffect(() => {
    let cancelled = false;
    void loadStoredTrack().then((restored) => {
      if (cancelled || !restored || restored.points.length === 0) return;
      // 復元が返るまでの間にユーザーが記録を始めていたら、そちらを優先する
      if (statusRef.current !== 'idle' || pointsRef.current.length > 0) return;
      pointsRef.current = restored.points;
      setPoints(restored.points);
      setDistanceMeters(summarizeTrack(restored.points).distanceMeters);
      setStartedAt(restored.meta.startedAt);
      setIntervalMs(restored.meta.intervalMs);
      setIsRestored(true);
      applyStatus('stopped');
    }).catch(() => {
      // 読み戻せなくても新しい記録は始められるので、ここでは何も言わない
    });
    return () => { cancelled = true; };
  }, [applyStatus]);

  // テレメトリが更新されるたびに 1 点積むか判定する。
  // 記録開始の直後にも走るため、開始時点の位置がそのまま最初の点になる
  useEffect(() => {
    if (status !== 'recording') return;

    const at = telemetry.lastReceivedAt ?? Date.now();
    const previous = pointsRef.current[pointsRef.current.length - 1];
    // テレメトリは記録間隔よりずっと細かく更新されるため、ここへ来る大半は間隔を満たさない。
    // 捨てるだけの点を組み立てないよう、経過時間だけで弾ける呼び出しを先に返す
    // （下の shouldRecordPoint が false を返す条件の一部をそのまま前倒ししている）
    if (previous && at >= previous.at && at - previous.at < intervalMs) return;

    const candidate = toTrackPoint(telemetry, at);
    if (!candidate) return;
    if (!shouldRecordPoint(previous, candidate, intervalMs)) return;

    if (pointsRef.current.length >= MAX_TRACK_POINTS) {
      // 古い点を捨てて詰め続けると、途中が欠けたログを完全なものとして
      // ダウンロードさせてしまう。上限に達したら記録のほうを止める
      setNotice(`記録できる上限（${MAX_TRACK_POINTS.toLocaleString()}点）に達したため記録を停止しました。`);
      stop();
      return;
    }

    pointsRef.current = [...pointsRef.current, candidate];
    pendingRef.current.push(candidate);
    setPoints(pointsRef.current);
    if (previous) setDistanceMeters((current) => current + stepDistanceMeters(previous, candidate));
  }, [intervalMs, status, stop, telemetry]);

  // 記録中は定期的に書き出す。停止時にも走る後始末で溜まったぶんを取りこぼさない
  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => { void flush(); }, TRACK_FLUSH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      void flush();
    };
  }, [flush, status]);

  // タブが隠れる瞬間にも書き出す。
  // beforeunload の中で IndexedDB へ書いても完了は保証されないため、そちらは警告専用にする
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [flush]);

  // 記録中の離脱を引き止める。直近の未書き出しぶんは失われるため
  useEffect(() => {
    if (status !== 'recording') return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status]);

  const stats: TrackStats = {
    count: points.length,
    distanceMeters,
    startedAt,
    endedAt: points.length > 0 ? points[points.length - 1].at : null,
  };

  return {
    status,
    points,
    stats,
    intervalMs,
    isRestored,
    notice,
    start,
    stop,
    resume,
    clear,
    setIntervalMs,
    dismissNotice,
    dismissRestored,
  };
}

/** 軌跡記録フックが返す一式。操作 UI がそのまま受け取る */
export type TrackRecorder = ReturnType<typeof useTrackRecorder>;
