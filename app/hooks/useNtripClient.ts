'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MountpointRecord, NtripConnectionConfig, SourceTableResponse } from '../lib/ntrip';
import type { NtripStatus } from '../lib/types';

/** 受信レートを再計算する間隔（ms） */
const RATE_SAMPLE_INTERVAL_MS = 1000;

type UseNtripClientOptions = {
  /** 受信した RTCM を受信機へ書き込むための関数 */
  writeToPort: (data: Uint8Array) => Promise<void>;
  /** 受信機への書き込み経路が使える状態かを返す */
  isWriterReady: () => boolean;
};

/**
 * NTRIP Caster への接続と、受信した RTCM の受信機への転送を担当するフック。
 *
 * 認証情報は API ルートへ POST のボディで渡す。クエリ文字列に載せると
 * サーバーのアクセスログやブラウザ履歴に平文で残るため。
 */
export function useNtripClient({ writeToPort, isWriterReady }: UseNtripClientOptions) {
  const [status, setStatus] = useState<NtripStatus>('idle');
  const [error, setError] = useState('');
  const [sourceTable, setSourceTable] = useState<MountpointRecord[]>([]);
  const [isFetchingSources, setIsFetchingSources] = useState(false);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [rateKbps, setRateKbps] = useState(0);
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  /**
   * 受信量と最終受信時刻の実体。
   *
   * チャンクは秒あたり数回届くが、画面に出るのは KB 表記と「N秒前」で、
   * どちらも秒単位の粒度しか持たない。チャンクごとに setState すると
   * 表示が変わらないまま画面全体を描き直すことになるため、
   * 受信ループでは ref だけを進め、下の 1 秒インターバルでまとめて state へ写す。
   */
  const bytesReceivedRef = useRef(0);
  const lastSampledBytesRef = useRef(0);
  const lastDataAtRef = useRef<number | null>(null);

  /** 接続を打ち切り、転送量の表示もリセットする */
  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
    setRateKbps(0);
  }, []);

  /** 配信局一覧を取得する。認証情報を含まないため GET でよい */
  const fetchSourceTable = useCallback(async (host: string, port: number) => {
    setIsFetchingSources(true);
    setError('');
    try {
      const response = await fetch(`/api/ntrip/sourcetable?host=${encodeURIComponent(host)}&port=${port}`);
      const data: Partial<SourceTableResponse> & { error?: string } = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || '配信局一覧の取得に失敗しました。');
      }
      const records = data.records ?? [];
      setSourceTable(records);
      return records;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Source-tableの取得に失敗しました。');
      return [];
    } finally {
      setIsFetchingSources(false);
    }
  }, []);

  /** Caster へ接続し、受信した RTCM をそのまま受信機へ流し込む */
  const start = useCallback(async (config: NtripConnectionConfig) => {
    if (!config.mountpoint) {
      setError('マウントポイントを指定してください。');
      return;
    }
    if (!isWriterReady()) {
      setError('TakionCM001受信機に接続してください（Web Serial未接続）。');
      return;
    }

    stop();
    setError('');
    setStatus('connecting');
    setBytesReceived(0);
    bytesReceivedRef.current = 0;
    lastSampledBytesRef.current = 0;
    // 前回接続の受信時刻が残っていると、繋ぎ直した直後に「補正が生きている」と誤判定される
    lastDataAtRef.current = null;
    setLastDataAt(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/ntrip/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || `NTRIPストリーム接続エラー (HTTP ${response.status})`);
      }
      if (!response.body) throw new Error('レスポンスボディが空です。');

      setStatus('connected');
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        bytesReceivedRef.current += value.byteLength;
        lastDataAtRef.current = Date.now();
        await writeToPort(value).catch((writeError: unknown) => {
          console.error('シリアル書き込みエラー:', writeError);
        });
      }

      setStatus('idle');
      setRateKbps(0);
    } catch (streamError) {
      setRateKbps(0);
      if (controller.signal.aborted) {
        setStatus('idle');
      } else {
        setStatus('error');
        setError(streamError instanceof Error ? streamError.message : 'NTRIP接続が切断されました。');
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [isWriterReady, stop, writeToPort]);

  // 接続中は毎秒、受信量・最終受信時刻・転送レートをまとめて state へ写す。
  // 値が前回と同じなら React 側で再描画が省かれるため、無通信の間は描き直しが起きない
  useEffect(() => {
    if (status !== 'connected') return;
    const timer = window.setInterval(() => {
      const delta = bytesReceivedRef.current - lastSampledBytesRef.current;
      lastSampledBytesRef.current = bytesReceivedRef.current;
      setBytesReceived(bytesReceivedRef.current);
      setLastDataAt(lastDataAtRef.current);
      setRateKbps(Math.max(0, Number((delta / 1024).toFixed(1))));
    }, RATE_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status]);

  // アンマウント時に接続を確実に閉じる
  useEffect(() => () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  return {
    status,
    error,
    sourceTable,
    isFetchingSources,
    bytesReceived,
    rateKbps,
    lastDataAt,
    fetchSourceTable,
    start,
    stop,
  };
}
