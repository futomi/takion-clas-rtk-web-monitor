'use client';

import { useCallback, useEffect, useState } from 'react';
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
import PositionPanel from './components/PositionPanel';
import { useClock } from './hooks/useClock';
import { useCorrectionStatus } from './hooks/useCorrectionStatus';
import { useGnssReceiver } from './hooks/useGnssReceiver';
import { useIsSerialSupported } from './hooks/useIsSerialSupported';
import { useNtripClient } from './hooks/useNtripClient';
import { useNtripForm } from './hooks/useNtripForm';
import { DEFAULT_BAUD_RATE } from './lib/constants';
import { formatSecondsAgo } from './lib/format';
import type { CorrectionMode, LogCategoryFilter, LogDisplayMode, LogLine } from './lib/types';

/**
 * 画面全体の組み立て役。
 *
 * 受信機・NTRIP・設定フォーム・補正ソース判定はいずれもフックへ委ね、
 * ここではそれらを繋いでセクションを並べることに徹する。
 */
export default function MonitorClient() {
  const isSupported = useIsSerialSupported();
  const clock = useClock();

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
    // NTRIP を初めて開いたときは配信局一覧を先読みしておく
    if (nextMode === 'ntrip' && ntrip.sourceTable.length === 0 && !ntrip.isFetchingSources) {
      void handleRefreshSources();
    }
  }, [mode, ntripStop, ntrip.sourceTable.length, ntrip.isFetchingSources, handleRefreshSources]);

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

  // LogPanel は memo 済み。インラインで渡すと毎レンダー別物になり memo が効かないため、
  // モーダル開閉と受信機接続のハンドラはここで同一性を固定しておく
  const handleOpenDictionary = useCallback(() => setShowDictionary(true), []);
  const handleCloseDictionary = useCallback(() => setShowDictionary(false), []);
  const handleCloseLogDetail = useCallback(() => setSelectedLog(null), []);
  const handleConnect = useCallback(() => {
    void receiverConnect(baudRate);
  }, [receiverConnect, baudRate]);

  // 受信機との接続が切れたら NTRIP も止める。
  // 手動の切断だけでなく、ケーブルが抜けた場合など受信側から切れたときも確実に畳む。
  useEffect(() => {
    if (connection === 'idle') ntripStop();
  }, [connection, ntripStop]);

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

      {mode === 'ntrip' && (
        <NtripConfigPanel
          form={ntripForm}
          onFormChange={updateNtripForm}
          activeMountpoint={activeMountpoint}
          candidates={candidates}
          ntrip={ntrip}
          clock={clock}
          connection={connection}
          telemetry={telemetry}
          onRefreshSources={() => void handleRefreshSources()}
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

      <section className="dashboard" aria-label="測位情報">
        <PositionPanel telemetry={telemetry} activeSource={activeSource} quality={quality} />
        <FixPanel
          telemetry={telemetry}
          activeSource={activeSource}
          quality={quality}
          connection={connection}
          lastAge={lastAge}
        />
        <MotionPanel telemetry={telemetry} />
      </section>

      <MapSection telemetry={telemetry} activeSource={activeSource} quality={quality} />

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
