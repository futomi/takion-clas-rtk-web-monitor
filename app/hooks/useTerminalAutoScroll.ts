'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_SCROLL_THRESHOLD_PX } from '../lib/constants';

type UseTerminalAutoScrollOptions = {
  /** 新しいログを上に積むか（true なら最新は最上部） */
  isNewestFirst: boolean;
  /**
   * 表示内容の版。参照（または値）が変わるたびに最新位置へ追従し直す。
   * 複数の要因で追従したい場合は、呼び出し側で 1 つの値にまとめて渡す。
   */
  revision: unknown;
  /** 追従を一時停止するか */
  paused: boolean;
};

/**
 * ログ端末の自動追従を扱うフック。
 *
 * 「最新位置へ移動する」処理は、表示順によって最上部/最下部が入れ替わるうえ、
 * プログラムによるスクロールを onScroll ハンドラが「ユーザー操作」と誤検知しないよう
 * フラグで抑止する必要がある。この 2 点をここに閉じ込め、呼び出し側は
 * `scrollToLatest()` と `handleScroll` を使うだけでよいようにしている。
 */
export function useTerminalAutoScroll({ isNewestFirst, revision, paused }: UseTerminalAutoScrollOptions) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const pendingFrameRef = useRef<number | null>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  /** 表示順に応じた「最新側」の scrollTop を返す */
  const latestScrollTop = useCallback(
    (element: HTMLElement) => (isNewestFirst ? 0 : element.scrollHeight),
    [isNewestFirst],
  );

  /** 予約済みの位置合わせを取り消す */
  const cancelPendingSnap = useCallback(() => {
    if (pendingFrameRef.current === null) return;
    cancelAnimationFrame(pendingFrameRef.current);
    pendingFrameRef.current = null;
    isProgrammaticScrollRef.current = false;
  }, []);

  /**
   * 最新位置へ移動する。
   * 直後の再描画で高さが変わることがあるため、次フレームでもう一度合わせてから
   * ユーザー操作の検知を再開する。
   */
  const snapToLatest = useCallback(() => {
    const element = terminalRef.current;
    if (!element) return;

    cancelPendingSnap();
    isProgrammaticScrollRef.current = true;
    element.scrollTop = latestScrollTop(element);

    pendingFrameRef.current = requestAnimationFrame(() => {
      if (terminalRef.current) {
        terminalRef.current.scrollTop = latestScrollTop(terminalRef.current);
      }
      pendingFrameRef.current = requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        isProgrammaticScrollRef.current = false;
      });
    });
  }, [cancelPendingSnap, latestScrollTop]);

  /** 「最新ログへ移動」ボタン用。追従を再開したうえで移動する */
  const scrollToLatest = useCallback(() => {
    setIsAutoScroll(true);
    snapToLatest();
  }, [snapToLatest]);

  /** ユーザーが手動でスクロールしたときに追従の要否を判定する */
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current || !terminalRef.current) return;
    const element = terminalRef.current;
    // 最新側の端から一定距離以内にいる間だけ追従する
    const distanceFromLatest = isNewestFirst
      ? element.scrollTop
      : element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsAutoScroll(distanceFromLatest <= AUTO_SCROLL_THRESHOLD_PX);
  }, [isNewestFirst]);

  // 追従が有効な間、内容が更新されるたびに最新位置へ合わせ続ける
  useEffect(() => {
    if (paused || !isAutoScroll) return;
    snapToLatest();
  }, [paused, isAutoScroll, snapToLatest, revision]);

  // アンマウント時に予約済みのフレームを残さない
  useEffect(() => cancelPendingSnap, [cancelPendingSnap]);

  return { terminalRef, isAutoScroll, setIsAutoScroll, scrollToLatest, handleScroll };
}
