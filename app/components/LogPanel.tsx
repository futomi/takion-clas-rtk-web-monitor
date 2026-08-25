'use client';

import { memo, useMemo } from 'react';
import { LOG_LIMIT_OPTIONS, LOG_TYPE_CHIP_COUNT } from '../lib/constants';
import { formatKilobytes } from '../lib/format';
import { buildCategoryOptions, type MessageCategory } from '../lib/messageDictionary';
import { useTerminalAutoScroll } from '../hooks/useTerminalAutoScroll';
import type { LogCategoryFilter, LogDisplayMode, LogLine } from '../lib/types';
import LogLineRow from './LogLineRow';

type LogPanelProps = {
  logs: LogLine[];
  displayMode: LogDisplayMode;
  onDisplayModeChange: (mode: LogDisplayMode) => void;
  categoryFilter: LogCategoryFilter;
  onCategoryFilterChange: (filter: LogCategoryFilter) => void;
  maxLogs: number;
  onMaxLogsChange: (maxLogs: number) => void;
  isNewestFirst: boolean;
  onIsNewestFirstChange: (isNewestFirst: boolean) => void;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onClear: () => void;
  onOpenDictionary: () => void;
  onSelectLine: (line: LogLine) => void;
  frameCount: number;
  byteCount: number;
};

/** ログ絞り込みの選択肢。並びと表記は電文リファレンスのタブと同じ定義元から引く */
const CATEGORY_FILTER_OPTIONS = buildCategoryOptions('全電文');

const DISPLAY_MODE_OPTIONS: { value: LogDisplayMode; label: string }[] = [
  { value: 'explained', label: '💡 解説付き' },
  { value: 'summary', label: '📝 日本語要約' },
  { value: 'raw', label: '💻 生ログのみ' },
];

/** 受信数の多い順に電文種別を数え上げる */
function countTopTypes(logs: LogLine[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const line of logs) {
    counts.set(line.type, (counts.get(line.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LOG_TYPE_CHIP_COUNT);
}

/**
 * 受信ログパネル。ツールバー、統計、端末表示をまとめる。
 *
 * 親は経過時間表示のため毎秒再描画されるが、このパネルはログと表示設定にしか依存しない。
 * 最大 1000 行を毎秒組み直さないよう memo で包む（そのため親から渡すハンドラは
 * すべて同一性の保たれたものにしてある）。
 */
function LogPanel({
  logs,
  displayMode,
  onDisplayModeChange,
  categoryFilter,
  onCategoryFilterChange,
  maxLogs,
  onMaxLogsChange,
  isNewestFirst,
  onIsNewestFirstChange,
  paused,
  onPausedChange,
  onClear,
  onOpenDictionary,
  onSelectLine,
  frameCount,
  byteCount,
}: LogPanelProps) {
  const topTypes = useMemo(() => countTopTypes(logs), [logs]);

  const displayedLogs = useMemo(() => {
    const filtered = categoryFilter === 'all'
      ? logs
      : logs.filter((line) => line.category === categoryFilter);
    return isNewestFirst ? [...filtered].reverse() : filtered;
  }, [logs, isNewestFirst, categoryFilter]);

  // 行の並びと表示モードのどちらが変わっても行の高さが変わるため、両方を追従のトリガーにする
  const contentRevision = useMemo(
    () => ({ displayedLogs, displayMode }),
    [displayedLogs, displayMode],
  );

  const { terminalRef, isAutoScroll, setIsAutoScroll, scrollToLatest, handleScroll } =
    useTerminalAutoScroll({ isNewestFirst, paused, revision: contentRevision });

  /**
   * 表示順を切り替えたら追従を有効化する。
   * 位置合わせは `isNewestFirst` の変化を見たフック側の効果が行うので、ここでは呼ばない
   * （この時点ではまだ古い並び順のため、自前で動かすと逆側へ飛んでしまう）。
   */
  const changeOrder = (nextIsNewestFirst: boolean) => {
    onIsNewestFirstChange(nextIsNewestFirst);
    setIsAutoScroll(true);
  };

  return (
    <section className="log-panel panel" aria-label="受信ログ">
      <div className="log-heading">
        <div>
          <h3>受信ログ</h3>
        </div>
        <div className="log-actions">
          <select
            className="log-control"
            value={displayMode}
            onChange={(event) => onDisplayModeChange(event.target.value as LogDisplayMode)}
            aria-label="ログの表示形式"
          >
            {DISPLAY_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            className="log-control"
            value={categoryFilter}
            onChange={(event) => onCategoryFilterChange(event.target.value as 'all' | MessageCategory)}
            aria-label="ログの種別絞り込み"
          >
            {CATEGORY_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            className="log-control"
            value={maxLogs}
            onChange={(event) => onMaxLogsChange(Number(event.target.value))}
            aria-label="ログの保持件数"
          >
            {LOG_LIMIT_OPTIONS.map((limit) => (
              <option value={limit} key={limit}>{limit}行</option>
            ))}
          </select>

          <select
            className="log-control"
            value={isNewestFirst ? 'newest' : 'oldest'}
            onChange={(event) => changeOrder(event.target.value === 'newest')}
            aria-label="ログの表示順"
          >
            <option value="oldest">古い順</option>
            <option value="newest">新しい順</option>
          </select>

          <button
            type="button"
            className="log-control dict-btn"
            onClick={onOpenDictionary}
            title="受信電文（NMEA / UBX / RTCM）の意味一覧を開く"
          >
            📖 電文解説
          </button>

          <button type="button" className="log-control" onClick={() => onPausedChange(!paused)}>
            {paused ? '再開' : '一時停止'}
          </button>

          <button type="button" className="log-control" onClick={onClear}>
            クリア
          </button>
        </div>
      </div>

      <div className="log-summary">
        <div><span>受信フレーム</span><strong>{frameCount.toLocaleString()}</strong></div>
        <div><span>受信サイズ</span><strong>{formatKilobytes(byteCount)}</strong></div>
        <div className="sentence-chips">
          {topTypes.length > 0
            ? topTypes.map(([type, count]) => <span key={type}>{type} <b>{count}</b></span>)
            : <span>データ待ち</span>}
        </div>
      </div>

      {/*
        流れ続けるログ本体には aria-live を付けない。毎秒数十行が追加される領域を
        読み上げ続けると、支援技術の利用者は他の操作ができなくなる。
        代わりに、利用者の操作でしか変わらない収集状態だけをここで知らせる。
      */}
      <p className="visually-hidden" aria-live="polite">
        {paused ? '受信ログの収集を一時停止しました。' : '受信ログを収集しています。'}
      </p>

      <div className="terminal-wrapper">
        {/*
          スクロールできる領域なので、キーボードだけでも中身をたどれるようフォーカスを受ける。
          `role` を付けるのは、素の div に付けた aria-label が支援技術に無視されるため。
          `log` ではなく `group` を選ぶのは、`log` が暗黙の aria-live を伴い、
          上で避けたはずの読み上げが復活してしまうため。
        */}
        <div
          ref={terminalRef}
          className="terminal"
          onScroll={handleScroll}
          role="group"
          tabIndex={0}
          aria-label="受信した測位データ"
        >
          {displayedLogs.length === 0 ? (
            <div className="terminal-empty">
              <span className="terminal-cursor" />
              <p>受信機に接続すると、受信した電文の意味とデータがリアルタイムに流れます。</p>
            </div>
          ) : (
            displayedLogs.map((line) => (
              <LogLineRow key={line.id} line={line} mode={displayMode} onSelect={onSelectLine} />
            ))
          )}
        </div>

        {!isAutoScroll && displayedLogs.length > 0 && (
          <button
            type="button"
            className="scroll-to-latest-btn"
            onClick={scrollToLatest}
            title="最新のログへスクロールして自動追従を再開します"
          >
            <span>{isNewestFirst ? '⬆' : '⬇'} 最新ログへ移動（自動追従 再開）</span>
          </button>
        )}
      </div>
    </section>
  );
}

export default memo(LogPanel);
