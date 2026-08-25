'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 一定時間で自動的に消えるメッセージを扱うフック。
 *
 * 表示中に次のメッセージが来た場合は、前のタイマーを捨てて数え直す。
 * アンマウント時にタイマーが残ると、消えたコンポーネントに対して
 * setState してしまうため、後始末もここに閉じ込める。
 */
export function useTemporaryMessage(durationMs: number) {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** メッセージを消し、予約済みの自動消去も取り消す */
  const clear = useCallback(() => {
    cancelTimer();
    setMessage('');
  }, [cancelTimer]);

  /** メッセージを表示し、`durationMs` 後に自動で消す */
  const show = useCallback((next: string) => {
    cancelTimer();
    setMessage(next);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMessage('');
    }, durationMs);
  }, [cancelTimer, durationMs]);

  useEffect(() => cancelTimer, [cancelTimer]);

  return { message, show, clear };
}
