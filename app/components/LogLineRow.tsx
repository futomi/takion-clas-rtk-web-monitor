import { memo } from 'react';
import type { LogDisplayMode, LogLine } from '../lib/types';
import ChecksumBadge from './ChecksumBadge';
import LogTimestamp from './LogTimestamp';

type LogLineRowProps = {
  line: LogLine;
  mode: LogDisplayMode;
  onSelect: (line: LogLine) => void;
};

/** 解説行の本体。「解説付き」と「日本語要約」で共通の並び */
function ExplainedHeader({ line }: { line: LogLine }) {
  return (
    <>
      <LogTimestamp receivedAt={line.receivedAt} />
      <span className={`cat-badge ${line.category || 'other'}`}>{line.categoryJa || '電文'}</span>
      <span className="type-pill">{line.type}</span>
      <span className="log-title-ja">{line.titleJa}</span>
      <span className="log-meaning-summary">{line.meaning}</span>
      <ChecksumBadge valid={line.valid} />
    </>
  );
}

/**
 * 受信ログの 1 行。
 *
 * 「生ログのみ」「解説付き」「日本語要約」の 3 モードを扱うが、
 * 解説付きは日本語要約に生ログ行を足したものなので、ヘッダ部分を共有している。
 *
 * 親は毎秒の経過時間更新と受信チャンクごとに再描画されるのに対し、`line` は生成後に
 * 変化しない。最大 1000 行を毎秒描き直さないよう memo で包み、追加された行だけを描画する。
 */
function LogLineRow({ line, mode, onSelect }: LogLineRowProps) {
  return (
    <div
      className="log-line"
      onClick={() => onSelect(line)}
      title="クリックしてこの電文の詳しい解説を表示"
    >
      {mode === 'raw' && (
        <div className="log-line-raw">
          <LogTimestamp receivedAt={line.receivedAt} />
          <span className="log-type">{line.type}</span>
          <code>{line.rawText}</code>
          <ChecksumBadge valid={line.valid} />
        </div>
      )}

      {mode === 'summary' && (
        <div className="log-line-summary">
          <ExplainedHeader line={line} />
        </div>
      )}

      {mode === 'explained' && (
        <div className="log-line-explained">
          <div className="log-line-header">
            <ExplainedHeader line={line} />
          </div>
          <div className="log-raw-secondary">
            <code>{line.rawText}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(LogLineRow);
