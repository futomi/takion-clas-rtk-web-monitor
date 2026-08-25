'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { concatBytes } from '../lib/bytes';
import { DEFAULT_MAX_LOGS, UBLOX_VENDOR_ID } from '../lib/constants';
import { scanFrames, trimStaleBuffer, type ScannedFrame } from '../lib/frameScanner';
import { createLogEntry, createLogIdGenerator, createRtcmLogEntry, createUbxLogEntry } from '../lib/logEntry';
import { parseNmea } from '../lib/nmea';
import { PvtOutputNegotiator } from '../lib/pvtOutputNegotiator';
import { parseRtcm } from '../lib/rtcm';
import { SatelliteTracker } from '../lib/satelliteTracker';
import { parseUbx } from '../lib/ubx';
import type { Telemetry } from '../lib/telemetry';
import type { ConnectionState, LogLine } from '../lib/types';
import { getSerialApi, type SerialPortInfo, type SerialPortLike } from '../lib/webSerial';

/**
 * TakionCM001（u-blox 系受信機）との Web Serial 接続を一手に引き受けるフック。
 *
 * ポートの開閉、受信バイト列のフレーム分解、テレメトリと受信ログの更新を担当する。
 * NAV-PVT 出力の一時的な有効化は {@link PvtOutputNegotiator} に委ねる。
 * UI 側はここが返す状態を描画するだけでよい。
 */
export function useGnssReceiver() {
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState('');
  const [portInfo, setPortInfo] = useState<SerialPortInfo>({});
  const [frameCount, setFrameCount] = useState(0);
  const [byteCount, setByteCount] = useState(0);
  const [lastL6At, setLastL6At] = useState<number | null>(null);
  const [l6Summary, setL6Summary] = useState('');

  // ログ収集の設定。受信ループから同期的に読むため ref にも同じ値を持つ
  const [maxLogs, setMaxLogsState] = useState<number>(DEFAULT_MAX_LOGS);
  const [paused, setPausedState] = useState(false);
  const maxLogsRef = useRef<number>(DEFAULT_MAX_LOGS);
  const pausedRef = useRef(false);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readTaskRef = useRef<Promise<void> | null>(null);
  const keepReadingRef = useRef(false);

  const trackerRef = useRef(new SatelliteTracker());
  const nextLogIdRef = useRef(createLogIdGenerator());

  const negotiatorRef = useRef<PvtOutputNegotiator | null>(null);
  negotiatorRef.current ??= new PvtOutputNegotiator({
    canWrite: () => writerRef.current !== null,
    write: async (frame) => {
      const writer = writerRef.current;
      if (writer) await writer.write(frame);
    },
    onError: setError,
  });
  const negotiator = negotiatorRef.current;

  /** ログ収集を止めるかどうか。UI 側の一時停止ボタンから制御する */
  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
  }, []);

  /** 保持するログ行数の上限 */
  const setMaxLogs = useCallback((next: number) => {
    maxLogsRef.current = next;
    setMaxLogsState(next);
    setLogs((current) => current.slice(-next));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  /**
   * 1 チャンク分のフレーム群をまとめて状態へ反映する。
   *
   * 電文ごとに setState せず 1 回にまとめることで再描画回数を抑えるとともに、
   * 同一チャンク内の GGA と GSA が使用衛星数を互いに上書きし合う問題を避けている。
   */
  const consumeFrames = useCallback((frames: ScannedFrame[], receivedAt: number) => {
    if (frames.length === 0) return;

    const tracker = trackerRef.current;
    const combinedUpdate: Partial<Telemetry> = { lastReceivedAt: receivedAt };
    const entries: LogLine[] = [];
    let sawGsv = false;
    let sawGsa = false;
    let l6At: number | null = null;
    let l6Text: string | null = null;

    for (const frame of frames) {
      if (frame.kind === 'nmea') {
        const parsed = parseNmea(frame.text);
        if (parsed.gsv) {
          tracker.applyGsv(parsed.gsv, receivedAt);
          sawGsv = true;
        }
        if (parsed.gsa) {
          tracker.applyGsa(parsed.gsa, receivedAt);
          sawGsa = true;
        }
        Object.assign(combinedUpdate, parsed.update);
        entries.push(createLogEntry(parsed, frame.text, receivedAt, nextLogIdRef.current()));
        continue;
      }

      if (frame.kind === 'ubx') {
        negotiator.handleFrame(frame.frame);
        const parsed = parseUbx(frame.frame);
        if (parsed.type === 'QZSSL6') {
          l6At = receivedAt;
          if (parsed.summary) l6Text = parsed.summary;
        }
        Object.assign(combinedUpdate, parsed.update);
        entries.push(createUbxLogEntry(parsed, frame.frame.length, receivedAt, nextLogIdRef.current()));
        continue;
      }

      const parsed = parseRtcm(frame.frame);
      entries.push(createRtcmLogEntry(parsed, frame.frame.length, receivedAt, nextLogIdRef.current()));
    }

    // 衛星の集計はチャンク内の全 GSV / GSA を取り込んだ後で一度だけ行う
    if (sawGsv) {
      const inView = tracker.inViewSummary(receivedAt);
      combinedUpdate.satellitesInView = inView.total;
      combinedUpdate.satellitesInViewBreakdown = inView.breakdown;
    }
    if (sawGsa) {
      const used = tracker.usedSummary(receivedAt);
      combinedUpdate.satellitesUsedBreakdown = used.breakdown;
      // GGA が衛星数を持っていればそちらを優先し、無い場合だけ GSA の集計で補う
      if (combinedUpdate.satellitesUsed === undefined && used.total > 0) {
        combinedUpdate.satellitesUsed = used.total;
      }
    }

    setTelemetry((current) => ({ ...current, ...combinedUpdate }));
    setFrameCount((current) => current + entries.length);
    if (l6At !== null) setLastL6At(l6At);
    if (l6Text !== null) setL6Summary(l6Text);
    if (!pausedRef.current) {
      setLogs((current) => [...current, ...entries].slice(-maxLogsRef.current));
    }
  }, [negotiator]);

  /** ポートから読み続け、完成したフレームを順次処理する */
  const readFromPort = useCallback(async (port: SerialPortLike) => {
    if (!port.readable) throw new Error('受信ストリームを開けませんでした。');
    const reader = port.readable.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder('ascii');
    let pending: Uint8Array = new Uint8Array(0);

    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        setByteCount((current) => current + value.byteLength);

        const merged = concatBytes(pending, value);
        const { frames, consumed } = scanFrames(merged, decoder);
        consumeFrames(frames, Date.now());
        pending = trimStaleBuffer(merged.slice(consumed));
      }
    } catch (readError) {
      if (keepReadingRef.current) {
        setError(readError instanceof Error ? readError.message : '受信中に接続が切れました。');
      }
    } finally {
      reader.releaseLock();
      if (readerRef.current === reader) readerRef.current = null;
    }
  }, [consumeFrames]);

  /** 補正データを受信機へ書き込む。NTRIP クライアントから使う */
  const writeToPort = useCallback(async (data: Uint8Array) => {
    await writerRef.current?.write(data);
  }, []);

  const isWriterReady = useCallback(() => writerRef.current !== null, []);

  /** 衛星集計と一時設定をすべて初期化する */
  const resetSession = useCallback(() => {
    trackerRef.current.reset();
    negotiator.reset();
  }, [negotiator]);

  const disconnect = useCallback(async (unexpected = false) => {
    if (!portRef.current) return;
    setConnection('disconnecting');
    keepReadingRef.current = false;
    try {
      // 一時的に有効化した出力設定は必ず元へ戻す
      await negotiator.restore();
      await readerRef.current?.cancel();
      await readTaskRef.current;
      writerRef.current?.releaseLock();
      writerRef.current = null;
      await portRef.current.close();
    } catch (closeError) {
      if (!unexpected) setError(closeError instanceof Error ? closeError.message : '切断できませんでした。');
    } finally {
      portRef.current = null;
      readTaskRef.current = null;
      resetSession();
      setConnection('idle');
    }
  }, [negotiator, resetSession]);

  const connect = useCallback(async (baudRate: number) => {
    const serial = getSerialApi();
    if (!serial) {
      setError('Web Serial APIを利用できません。最新版のChromeで、localhostまたはHTTPSから開いてください。');
      return;
    }

    setError('');
    setConnection('connecting');
    setTelemetry({});
    setLogs([]);
    setFrameCount(0);
    setByteCount(0);
    setLastL6At(null);
    setL6Summary('');
    resetSession();

    try {
      const port = await serial.requestPort({ filters: [{ usbVendorId: UBLOX_VENDOR_ID }] });
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 65536 });
      portRef.current = port;
      if (!port.writable) throw new Error('受信機への照会ストリームを開けませんでした。');
      writerRef.current = port.writable.getWriter();
      setPortInfo(port.getInfo());
      setConnection('connected');
      keepReadingRef.current = true;
      readTaskRef.current = readFromPort(port).finally(() => {
        // 読み取りが意図せず終わった場合は後片付けを行う
        if (keepReadingRef.current) void disconnect(true);
      });
      await negotiator.start();
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : '';
      // ポート選択ダイアログのキャンセルはエラー扱いしない
      if (!message.toLowerCase().includes('no port selected')) {
        setError(message || '受信機に接続できませんでした。');
      }
      writerRef.current?.releaseLock();
      writerRef.current = null;
      if (portRef.current) await portRef.current.close().catch(() => undefined);
      portRef.current = null;
      setConnection('idle');
    }
  }, [disconnect, negotiator, readFromPort, resetSession]);

  // アンマウント時は読み取りを止め、開いたままのポートを解放する
  useEffect(() => () => {
    keepReadingRef.current = false;
    void readerRef.current?.cancel();
    void portRef.current?.close().catch(() => undefined);
    portRef.current = null;
  }, []);

  return {
    connection,
    telemetry,
    logs,
    error,
    portInfo,
    frameCount,
    byteCount,
    lastL6At,
    l6Summary,
    maxLogs,
    paused,
    connect,
    disconnect,
    setError,
    setPaused,
    setMaxLogs,
    clearLogs,
    writeToPort,
    isWriterReady,
  };
}
