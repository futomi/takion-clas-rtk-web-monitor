import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type ModalProps = {
  onClose: () => void;
  /** ヘッダ左側に置く要素（カテゴリバッジやアイコン） */
  titleAccessory?: ReactNode;
  title: string;
  /** モーダル本体の最大幅。既定はスタイルシート側の値を使う */
  maxWidth?: string;
  children: ReactNode;
};

/** Tab で辿れる要素。フォーカスを閉じ込める範囲の算出に使う */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * オーバーレイ付きモーダルの共通枠。
 * 個別電文の解説と電文リファレンス一覧で同じ構造を使う。
 *
 * `aria-modal` を名乗る以上、キーボード操作も閉じている必要がある。
 * 開いたらフォーカスをダイアログへ移し、Tab は内側で循環させ、閉じたら元の要素へ戻す。
 * これが無いと、支援技術の利用者は背後のページを操作できてしまう。
 */
export default function Modal({ onClose, titleAccessory, title, maxWidth, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // 開いた時点のフォーカス位置を覚えておき、閉じたら戻す
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Escape で閉じ、Tab はダイアログ内で循環させる
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // 端に達したら反対側へ送り返す。ダイアログ自身に居る場合も外へは出さない
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal-content"
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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
