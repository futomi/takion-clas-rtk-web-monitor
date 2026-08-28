'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppFooter from './components/AppFooter';
import AppHeader from './components/AppHeader';
import CorrectionModePanel from './components/CorrectionModePanel';
import DeviceToolbar from './components/DeviceToolbar';
import FixPanel from './components/FixPanel';
import LogDetailModal from './components/LogDetailModal';
import LogPanel from './components/LogPanel';
import MapSection from './components/MapSection';
import MessageDictionaryModal from './components/MessageDictionaryModal';
import MotionPanel from './components/MotionPanel';
import NtripConfigPanel from './components/NtripConfigPanel';
import NtripUnavailableNotice from './components/NtripUnavailableNotice';
import PositionPanel from './components/PositionPanel';
import { useClock } from './hooks/useClock';
import { useCorrectionStatus } from './hooks/useCorrectionStatus';
import { useGnssReceiver } from './hooks/useGnssReceiver';
import { useIsLoopbackOrigin } from './hooks/useIsLoopbackOrigin';
import { useIsSerialSupported } from './hooks/useIsSerialSupported';
import { useNtripClient } from './hooks/useNtripClient';
import { useNtripForm } from './hooks/useNtripForm';
import { useTrackRecorder } from './hooks/useTrackRecorder';
import { DEFAULT_BAUD_RATE } from './lib/constants';
import { formatSecondsAgo } from './lib/format';
import type { CorrectionMode, LogCategoryFilter, LogDisplayMode, LogLine, NtripLiveState } from './lib/types';

/**
 * 画面全体の組み立て役。
 *
 * 受信機・NTRIP・設定フォーム・補正ソース判定はいずれもフックへ委ね、
 * ここではそれらを繋いでセクションを並べることに徹する。
 */
type MonitorClientProps = {
  /** ループバック以外から開いた場合もネットワーク RTK を有効にするか */
  isNtripAlwaysEnabled?: boolean;
};

export default function MonitorClient({ isNtripAlwaysEnabled = false }: MonitorClientProps) {
  const isSupported = useIsSerialSupported();
  const clock = useClock();

  /**
   * ネットワーク RTK を出してよいか。
   *
   * 公開環境では中継 API が 404 を返すため、フォームを出しても接続できない。
   * 判定の根拠は API 側（{@link ./lib/server/ntripAvailability}）と揃えてある。
   */
  const isLoopbackOrigin = useIsLoopbackOrigin();
  const isNtripAvailable = isNtripAlwaysEnabled || isLoopbackOrigin;

  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD_RATE);
  const [mode, setMode] = useState<CorrectionMode>('clas');

  // ログ表示設定とモーダル状態
  const [logDisplayMode, setLogDisplayMode] = useState<LogDisplayMode>('explained');
  const [logCategoryFilter, setLogCategoryFilter] = useState<LogCategoryFilter>('all');
  const [isNewestFirst, setIsNewestFirst] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogLine | null>(null);
  const [showDictionary, setShowDictionary] = useState(false);

  const receiver = useGnssReceiver();
  const ntrip = useNtripClient({
    writeToPort: receiver.writeToPort,
    isWriterReady: receiver.isWriterReady,
  });

  // フック本体は毎レンダー新しいオブジェクトを返すため、依存配列には個々の値・関数を入れる
  const {
    telemetry, connection, connect: receiverConnect, disconnect: receiverDisconnect, setMaxLogs, setPaused,
  } = receiver;
  const { fetchSourceTable: fetchNtripSources, start: ntripStart, stop: ntripStop } = ntrip;

  const track = useTrackRecorder(telemetry);
  const { stop: trackStop } = track;

  const { form: ntripForm, update: updateNtripForm, candidates, activeMountpoint } = useNtripForm({
    sourceTable: ntrip.sourceTable,
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
  });

  const { isL6Active, activeSource, quality } = useCorrectionStatus({
    mode,
    quality: telemetry.quality,
    ntripStatus: ntrip.status,
    ntripLastDataAt: ntrip.lastDataAt,
    lastL6At: receiver.lastL6At,
    mountpoint: activeMountpoint,
    clock,
  });

  const lastAge = telemetry.lastReceivedAt === undefined
    ? 'データ待ち'
    : formatSecondsAgo(telemetry.lastReceivedAt, clock);

  /** 配信局一覧を取り直す。未選択なら先頭を初期値にする */
  const handleRefreshSources = useCallback(async () => {
    const records = await fetchNtripSources(ntripForm.host, ntripForm.port);
    if (records.length > 0 && !ntripForm.mountpoint) {
      updateNtripForm({ mountpoint: records[0].mountpoint });
    }
  }, [fetchNtripSources, ntripForm.host, ntripForm.port, ntripForm.mountpoint, updateNtripForm]);

  /** 補正モードの切り替え。NTRIP から離れるときは接続を畳む */
  const handleModeChange = useCallback((nextMode: CorrectionMode) => {
    if (mode === nextMode) return;
    if (mode === 'ntrip' && nextMode !== 'ntrip') ntripStop();
    setMode(nextMode);
    // NTRIP を初めて開いたときは配信局一覧を先読みしておく。
    // 使えない環境では 404 を取りに行くだけなので、そもそも投げない
    if (isNtripAvailable && nextMode === 'ntrip' && ntrip.sourceTable.length === 0 && !ntrip.isFetchingSources) {
      void handleRefreshSources();
    }
  }, [
    mode,
    ntripStop,
    isNtripAvailable,
    ntrip.sourceTable.length,
    ntrip.isFetchingSources,
    handleRefreshSources,
  ]);

  const handleNtripConnect = useCallback(() => {
    void ntripStart({
      host: ntripForm.host,
      port: ntripForm.port,
      mountpoint: activeMountpoint,
      username: ntripForm.username,
      password: ntripForm.password,
    });
  }, [ntripStart, ntripForm.host, ntripForm.port, ntripForm.username, ntripForm.password, activeMountpoint]);

  const handleDisconnect = useCallback(() => {
    void receiverDisconnect();
  }, [receiverDisconnect]);

  // LogPanel と NtripConfigPanel は memo 済み。インラインで渡すと毎レンダー別物になり
  // memo が効かないため、モーダル開閉と接続まわりのハンドラはここで同一性を固定しておく
  const handleOpenDictionary = useCallback(() => setShowDictionary(true), []);
  const handleCloseDictionary = useCallback(() => setShowDictionary(false), []);
  const handleCloseLogDetail = useCallback(() => setSelectedLog(null), []);
  const handleConnect = useCallback(() => {
    void receiverConnect(baudRate);
  }, [receiverConnect, baudRate]);
  const handleRefreshSourcesClick = useCallback(() => {
    void handleRefreshSources();
  }, [handleRefreshSources]);

  // NTRIP フックの戻り値は毎レンダー新しいオブジェクトになる。
  // そのまま渡すと設定パネルの memo が素通りするため、描画に使う値だけを固定して渡す
  const ntripLive = useMemo<NtripLiveState>(() => ({
    status: ntrip.status,
    error: ntrip.error,
    isFetchingSources: ntrip.isFetchingSources,
    bytesReceived: ntrip.bytesReceived,
    rateKbps: ntrip.rateKbps,
    lastDataAt: ntrip.lastDataAt,
  }), [ntrip.status, ntrip.error, ntrip.isFetchingSources, ntrip.bytesReceived, ntrip.rateKbps, ntrip.lastDataAt]);

  // 受信機との接続が切れたら NTRIP も止める。
  // 手動の切断だけでなく、ケーブルが抜けた場合など受信側から切れたときも確実に畳む。
  //
  // 'idle' を待たず 'disconnecting' の時点で畳むのは、切断処理が受信機への書き込み経路を
  // 閉じるより先に RTCM の転送を止めたいため。順序が逆になると、閉じた経路へ書き込もうとして
  // 失敗し、正常な切断なのに NTRIP のエラーとして記録されてしまう。
  useEffect(() => {
    if (connection === 'disconnecting' || connection === 'idle') ntripStop();
  }, [connection, ntripStop]);

  // 受信機が切れたら軌跡の記録も止める。座標が来なくなったまま記録中の表示を続けると、
  // 止めるまでの空白がそのまま 1 本の線として繋がって見えてしまう。
  // 記録済みの軌跡は残すので、切断後もそのままダウンロードできる
  useEffect(() => {
    if (connection === 'disconnecting' || connection === 'idle') trackStop();
  }, [connection, trackStop]);

  return (
    <main className="app-shell">
      <AppHeader connection={connection} />

      <DeviceToolbar
        connection={connection}
        isSupported={isSupported}
        portInfo={receiver.portInfo}
        baudRate={baudRate}
        onBaudRateChange={setBaudRate}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <CorrectionModePanel
        mode={mode}
        onModeChange={handleModeChange}
        ntripStatus={ntrip.status}
        ntripRateKbps={ntrip.rateKbps}
        isL6Active={isL6Active}
        l6Summary={receiver.l6Summary}
      />

      {mode === 'ntrip' && !isNtripAvailable && <NtripUnavailableNotice />}

      {mode === 'ntrip' && isNtripAvailable && (
        <NtripConfigPanel
          form={ntripForm}
          onFormChange={updateNtripForm}
          activeMountpoint={activeMountpoint}
          candidates={candidates}
          ntrip={ntripLive}
          clock={clock}
          connection={connection}
          latitude={telemetry.latitude}
          longitude={telemetry.longitude}
          onRefreshSources={handleRefreshSourcesClick}
          onConnect={handleNtripConnect}
          onDisconnect={ntripStop}
        />
      )}

      {receiver.error && (
        <div className="error-banner" role="alert">
          <strong>接続エラー</strong>
          <span>{receiver.error}</span>
          <button type="button" onClick={() => receiver.setError('')}>閉じる</button>
        </div>
      )}

      {/*
        並び順は「どれだけ信頼できるか → どこにいるか → どう動いているか」。
        測位ステータスを先頭に置くのは、画面が狭いときにこの 1 枚だけを
        横いっぱいに広げて上の段へ出すため。見た目だけを CSS で入れ替えると、
        キーボードの移動順と読み上げ順が見た目とずれてしまう。
      */}
      <section className="dashboard" aria-label="測位情報">
        <FixPanel
          telemetry={telemetry}
          activeSource={activeSource}
          quality={quality}
          connection={connection}
          lastAge={lastAge}
        />
        <PositionPanel telemetry={telemetry} activeSource={activeSource} quality={quality} />
        <MotionPanel telemetry={telemetry} />
      </section>

      <MapSection
        telemetry={telemetry}
        activeSource={activeSource}
        quality={quality}
        connection={connection}
        track={track}
        clock={clock}
      />

      <LogPanel
        logs={receiver.logs}
        displayMode={logDisplayMode}
        onDisplayModeChange={setLogDisplayMode}
        categoryFilter={logCategoryFilter}
        onCategoryFilterChange={setLogCategoryFilter}
        maxLogs={receiver.maxLogs}
        onMaxLogsChange={setMaxLogs}
        isNewestFirst={isNewestFirst}
        onIsNewestFirstChange={setIsNewestFirst}
        paused={receiver.paused}
        onPausedChange={setPaused}
        onClear={receiver.clearLogs}
        onOpenDictionary={handleOpenDictionary}
        onSelectLine={setSelectedLog}
        frameCount={receiver.frameCount}
        byteCount={receiver.byteCount}
      />

      {selectedLog && <LogDetailModal line={selectedLog} onClose={handleCloseLogDetail} />}
      {showDictionary && <MessageDictionaryModal onClose={handleCloseDictionary} />}

      <AppFooter />
    </main>
  );
}
