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

/** 受信カウンタを state へ写す間隔（ms） */
const COUNTER_SAMPLE_INTERVAL_MS = 1000;
/**
 * 測位状態と受信ログを state へ写す間隔（ms）。
 *
 * チャンクは秒あたり数十回届くが、それを全部 state へ流すと画面全体の描き直しが
 * 同じ回数だけ走る。人が読めるのは画面の更新間隔までの粒度なので、
 * 受信ループでは ref へ積むだけにして、ここでまとめて写す。
 *
 * カウンタ側の 1 秒より短くしているのは、こちらは地図のマーカーや速度・方位など
 * 連続的に動くものを含むため。8 回/秒あれば動きは滑らかに見える。
 * `requestAnimationFrame` ではなくタイマーにしているのは、タブが背面に回っても
 * 止まらないようにするため（軌跡の記録はこの更新を起点に動く）。
 */
const TELEMETRY_SAMPLE_INTERVAL_MS = 125;
/** 切断時に受信機の設定を戻すのを待つ上限（ms） */
const RESTORE_TIMEOUT_MS = 1500;

/**
 * 期限付きで待つ。期限切れでも例外にはせず、そのまま次の後始末へ進む。
 *
 * ケーブルが抜けた直後の書き込みは、環境によっては解決も失敗もしないことがある。
 * 切断処理がそこで止まると `connection` が 'disconnecting' のまま固まり、
 * 画面から復帰できなくなってしまう。
 */
async function withTimeout(task: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: number | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => { timer = window.setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

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
  /**
   * 受信フレーム数と受信バイト数。
   *
   * チャンクは秒あたり何度も届くのに対し、画面に出るのは件数と KB 表記だけで、
   * どちらも秒単位の粒度しか持たない。チャンクごとに setState すると
   * 表示が変わらないまま画面全体を描き直すことになるため、
   * 受信ループでは ref だけを進め、下の 1 秒インターバルでまとめて state へ写す。
   */
  const [frameCount, setFrameCount] = useState(0);
  const [byteCount, setByteCount] = useState(0);
  const frameCountRef = useRef(0);
  const byteCountRef = useRef(0);
  const [lastL6At, setLastL6At] = useState<number | null>(null);
  const [l6Summary, setL6Summary] = useState('');

  /**
   * 受信ループが積み、{@link TELEMETRY_SAMPLE_INTERVAL_MS} ごとに state へ写される控え。
   *
   * 上の受信カウンタと同じ考え方で、測位状態・受信ログ・L6 の受信状況も
   * チャンクごとではなく一定間隔でまとめて反映する。
   */
  const telemetryRef = useRef<Telemetry>({});
  const telemetryDirtyRef = useRef(false);
  const pendingLogsRef = useRef<LogLine[]>([]);
  const pendingL6Ref = useRef<{ at: number | null; summary: string | null }>({ at: null, summary: null });

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

  // 写す前の控えも一緒に捨てる。残すと、消した直後に古い行が湧いて出る
  const clearLogs = useCallback(() => {
    pendingLogsRef.current = [];
    setLogs([]);
  }, []);

  /**
   * 受信ループが積んだぶんをまとめて state へ写す。
   *
   * 中身が無ければ何も呼ばないので、無通信の間は描き直しが起きない。
   */
  const flushReceived = useCallback(() => {
    if (telemetryDirtyRef.current) {
      telemetryDirtyRef.current = false;
      setTelemetry(telemetryRef.current);
    }

    if (pendingLogsRef.current.length > 0) {
      const appended = pendingLogsRef.current;
      pendingLogsRef.current = [];
      setLogs((current) => [...current, ...appended].slice(-maxLogsRef.current));
    }

    const l6 = pendingL6Ref.current;
    if (l6.at !== null) {
      setLastL6At(l6.at);
      l6.at = null;
    }
    if (l6.summary !== null) {
      setL6Summary(l6.summary);
      l6.summary = null;
    }
  }, []);

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
        // チェックサムは走査時に済んでいる。同じ計算を繰り返さないよう結果を渡す
        const parsed = parseUbx(frame.frame, frame.valid);
        if (parsed.type === 'QZSSL6') {
          l6At = receivedAt;
          if (parsed.summary) l6Text = parsed.summary;
        }
        Object.assign(combinedUpdate, parsed.update);
        entries.push(createUbxLogEntry(parsed, frame.frame.length, receivedAt, nextLogIdRef.current()));
        continue;
      }

      const parsed = parseRtcm(frame.frame, frame.valid);
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

    // ここでは state を触らず控えを進めるだけにして、写すのは flushReceived に任せる
    telemetryRef.current = { ...telemetryRef.current, ...combinedUpdate };
    telemetryDirtyRef.current = true;
    frameCountRef.current += entries.length;
    if (l6At !== null) pendingL6Ref.current.at = l6At;
    if (l6Text !== null) pendingL6Ref.current.summary = l6Text;

    if (!pausedRef.current) {
      const pending = pendingLogsRef.current;
      for (const entry of entries) pending.push(entry);
      // 写す先が上限で切り詰められる以上、控えを上限より多く抱えても捨てるだけになる。
      // 写す機会が来ないまま受信が続いた場合に、控えだけが際限なく膨らむのを防ぐ
      if (pending.length > maxLogsRef.current) {
        pendingLogsRef.current = pending.slice(-maxLogsRef.current);
      }
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

        byteCountRef.current += value.byteLength;

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

  /**
   * 補正データを受信機へ書き込む。NTRIP クライアントから使う。
   *
   * 経路が閉じている場合は黙って捨てず失敗として返す。
   * 受信機だけが切れた状態で RTCM を流し続けても、届いていないことに気付けないため。
   */
  const writeToPort = useCallback(async (data: Uint8Array) => {
    const writer = writerRef.current;
    if (!writer) throw new Error('受信機への書き込み経路が閉じています。');
    await writer.write(data);
  }, []);

  const isWriterReady = useCallback(() => writerRef.current !== null, []);

  /**
   * 受信ループを止め、reader が握っている readable のロックを返させる。
   *
   * 接続の途中で失敗した場合も切断の場合も、ここを通さずにポートを閉じると
   * `port.close()` が「ロック済みのストリームは閉じられない」で失敗し、
   * ポートが開いたまま残ってしまう。
   */
  const cancelReadTask = useCallback(async () => {
    keepReadingRef.current = false;
    // 呼び出し側は期限を切ってこれを待つため、待ち切れずに抜けた後で再接続が
    // 走ることがある。片付ける対象をここで固定し、新しい読み取りを消さないようにする
    const task = readTaskRef.current;
    try {
      await readerRef.current?.cancel();
    } catch {
      // 相手が既に居ない場合の cancel 失敗は、この後の後始末を妨げない
    }
    await task;
    if (readTaskRef.current === task) readTaskRef.current = null;
  }, []);

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
      // 一時的に有効化した出力設定は必ず元へ戻す。
      // 相手が既に居ない場合に備えて、待ち続けないよう期限を切る
      await withTimeout(negotiator.restore(), RESTORE_TIMEOUT_MS);
      // ケーブルが抜けた直後は cancel も解決しないことがある。
      // ここで待ち続けると 'disconnecting' のまま固まるため、同じく期限を切る
      await withTimeout(cancelReadTask(), RESTORE_TIMEOUT_MS);
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
  }, [cancelReadTask, negotiator, resetSession]);

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
    // 前回の接続で写しきれなかった控えを新しい接続へ持ち込まない
    telemetryRef.current = {};
    telemetryDirtyRef.current = false;
    pendingLogsRef.current = [];
    pendingL6Ref.current = { at: null, summary: null };
    frameCountRef.current = 0;
    byteCountRef.current = 0;
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
      // ポート選択ダイアログのキャンセルはエラー扱いしない。
      // ブラウザの文言に依存しないよう、例外の種別で判定する
      const isDialogCancelled = connectError instanceof DOMException && connectError.name === 'NotFoundError';
      if (!isDialogCancelled) {
        setError(message || '受信機に接続できませんでした。');
      }
      // 受信ループは接続手順の途中から既に走っている。ここで止めておかないと、
      // reader がロックを握ったままポートを閉じられず、開きっぱなしのまま
      // 画面だけが未接続に戻ってしまう
      await withTimeout(cancelReadTask(), RESTORE_TIMEOUT_MS);
      writerRef.current?.releaseLock();
      writerRef.current = null;
      if (portRef.current) await portRef.current.close().catch(() => undefined);
      portRef.current = null;
      setConnection('idle');
    }
  }, [cancelReadTask, disconnect, negotiator, readFromPort, resetSession]);

  // 接続中は毎秒、受信カウンタをまとめて state へ写す。
  // 値が前回と同じなら React 側で再描画が省かれるため、無通信の間は描き直しが起きない
  useEffect(() => {
    if (connection !== 'connected') return;
    const syncCounters = () => {
      setFrameCount(frameCountRef.current);
      setByteCount(byteCountRef.current);
    };
    const timer = window.setInterval(syncCounters, COUNTER_SAMPLE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      // 切断の瞬間に溜まっていたぶんを取りこぼさない
      syncCounters();
    };
  }, [connection]);

  // 接続中は測位状態と受信ログも一定間隔でまとめて写す。
  // カウンタと別の間隔で回すため、タイマーも別に持つ
  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = window.setInterval(flushReceived, TELEMETRY_SAMPLE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      // 切断の瞬間に溜まっていたぶんを取りこぼさない
      flushReceived();
    };
  }, [connection, flushReceived]);

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
