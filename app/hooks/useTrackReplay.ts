'use client';

import { useCallback, useEffect, useState } from 'react';
import { importTrack } from '../lib/trackImport';
import { replayStepDelayMs } from '../lib/trackReplay';
import type { TrackPoint } from '../lib/track';

/** 再生の状態。empty はファイルを読み込んでいない状態 */
export type ReplayStatus = 'empty' | 'ready' | 'playing' | 'paused' | 'finished';

/**
 * 書き出した記録ファイルを、記録どおりの間隔で 1 点ずつ再生するフック。
 *
 * 受信機を繋げない場所（屋内の会場など）で、屋外で取った軌跡をそのまま見せるためのもの。
 * 再生位置の点は {@link useLocalPlot} へ受信機の測位解の代わりに渡す。
 */
export function useTrackReplay() {
  const [status, setStatus] = useState<ReplayStatus>('empty');
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [fileName, setFileName] = useState('');
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  /** 読み込みと最初からのやり直しのたびに進む番号。プロット側が尾と原点を捨てる合図にする */
  const [session, setSession] = useState(0);

  // 点が 1 つしか無い記録は進めようが無いので、再生を始めた瞬間に終わったことにする
  const playingStatus: ReplayStatus = points.length < 2 ? 'finished' : 'playing';

  const load = useCallback(async (file: File) => {
    setError('');
    try {
      const imported = importTrack(await file.text());
      setPoints(imported.points);
      setFileName(file.name);
      setIndex(0);
      setStatus('ready');
      setSession((current) => current + 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ファイルを読み込めませんでした。');
    }
  }, []);

  const play = useCallback(() => {
    setStatus((current) => (current === 'ready' || current === 'paused' ? playingStatus : current));
  }, [playingStatus]);

  const pause = useCallback(() => {
    setStatus((current) => (current === 'playing' ? 'paused' : current));
  }, []);

  const restart = useCallback(() => {
    setIndex(0);
    setSession((current) => current + 1);
    setStatus(playingStatus);
  }, [playingStatus]);

  const eject = useCallback(() => {
    setStatus('empty');
    setPoints([]);
    setFileName('');
    setIndex(0);
    setError('');
  }, []);

  // 再生中は次の点までの間隔だけ待って 1 つ進める。最後の点へ着いたら終わり。
  // 一時停止や取り出しで status が変われば後始末でタイマーが消える
  useEffect(() => {
    if (status !== 'playing') return;
    const delay = replayStepDelayMs(points, index);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      if (nextIndex >= points.length - 1) setStatus('finished');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [index, points, status]);

  const current = status === 'empty' || points.length === 0
    ? null
    : points[Math.min(index, points.length - 1)];

  return {
    status,
    points,
    fileName,
    index,
    current,
    error,
    session,
    /** ファイルを読み込んでいるか。読み込んでいる間はプロットの入力元が再生に切り替わる */
    isActive: status !== 'empty',
    load,
    play,
    pause,
    restart,
    eject,
  };
}

/** 再生フックが返す一式。操作 UI がそのまま受け取る */
export type TrackReplay = ReturnType<typeof useTrackReplay>;
