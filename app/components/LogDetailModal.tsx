'use client';

import { useCallback, useEffect, useState } from 'react';
import { COPY_FEEDBACK_DURATION_MS } from '../lib/constants';
import { formatLogTime } from '../lib/format';
import { getMessageDefinition } from '../lib/messageDictionary';
import type { LogLine } from '../lib/types';
import MessageFieldsTable from './MessageFieldsTable';
import Modal from './Modal';

/** コピーボタンの表示状態 */
type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyState, string> = {
  idle: '📋 生テキストをコピー',
  copied: '✅ コピーしました',
  failed: '⚠️ コピーできませんでした',
};

/** クリックされた 1 電文の詳細解説モーダル */
export default function LogDetailModal({ line, onClose }: { line: LogLine; onClose: () => void }) {
  const definition = getMessageDefinition(line.type);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  /**
   * 生テキストをクリップボードへ写す。
   *
   * `navigator.clipboard` は安全なコンテキスト（HTTPS / localhost）でしか生えず、
   * 生えていても利用者が権限を拒めば失敗する。どちらも例外として飛んでくるため
   * まとめて受け止め、黙って握り潰さずボタンの文言で結果を伝える。
   */
  const copyRawText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(line.rawText);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [line.rawText]);

  // 結果表示を一定時間で元へ戻す
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  return (
    <Modal
      onClose={onClose}
      title={`${definition.displayName} · ${definition.titleJa}`}
      titleAccessory={<span className={`cat-badge ${definition.category}`}>{definition.categoryJa}</span>}
    >
      <div className="modal-section">
        <h4 className="modal-section-title">概要・役割</h4>
        <p className="modal-description">{definition.description}</p>
      </div>

      <div className="modal-section">
        <h4 className="modal-section-title">受信した生データ ({formatLogTime(line.receivedAt)})</h4>
        <pre className="modal-raw-box">{line.rawText}</pre>
        <div className="modal-section-actions">
          <button
            type="button"
            className="secondary-btn compact-btn"
            onClick={() => void copyRawText()}
            aria-live="polite"
          >
            {COPY_LABELS[copyState]}
          </button>
        </div>
      </div>

      <div className="modal-section">
        <h4 className="modal-section-title">この電文の意味・主な値</h4>
        <div className="modal-meaning-box">{line.meaning}</div>
      </div>

      {definition.fields && definition.fields.length > 0 && (
        <div className="modal-section">
          <h4 className="modal-section-title">主要フィールド解説</h4>
          <MessageFieldsTable fields={definition.fields} />
        </div>
      )}
    </Modal>
  );
}
