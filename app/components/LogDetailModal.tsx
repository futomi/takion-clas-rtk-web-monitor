'use client';

import { useCallback, useEffect, useState } from 'react';
import { COPY_FEEDBACK_DURATION_MS } from '../lib/constants';
import { formatLogTime } from '../lib/format';
import { getMessageDefinition } from '../lib/messageDictionary';
import type { LogLine } from '../lib/types';
import MessageFieldsTable from './MessageFieldsTable';
import Modal from './Modal';

/** クリックされた 1 電文の詳細解説モーダル */
export default function LogDetailModal({ line, onClose }: { line: LogLine; onClose: () => void }) {
  const definition = getMessageDefinition(line.type);
  const [copied, setCopied] = useState(false);

  const copyRawText = useCallback(() => {
    void navigator.clipboard.writeText(line.rawText).then(() => setCopied(true));
  }, [line.rawText]);

  // コピー完了表示を一定時間で戻す
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

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
          <button type="button" className="secondary-btn compact-btn" onClick={copyRawText}>
            {copied ? '✅ コピーしました' : '📋 生テキストをコピー'}
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
