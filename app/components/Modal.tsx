import type { ReactNode } from 'react';
import { useEffect } from 'react';

type ModalProps = {
  onClose: () => void;
  /** ヘッダ左側に置く要素（カテゴリバッジやアイコン） */
  titleAccessory?: ReactNode;
  title: string;
  /** モーダル本体の最大幅。既定はスタイルシート側の値を使う */
  maxWidth?: string;
  children: ReactNode;
};

/**
 * オーバーレイ付きモーダルの共通枠。
 * 個別電文の解説と電文リファレンス一覧で同じ構造を使う。
 */
export default function Modal({ onClose, titleAccessory, title, maxWidth, children }: ModalProps) {
  // Escape キーで閉じられるようにする
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-content"
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            {titleAccessory}
            <h3>{title}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
