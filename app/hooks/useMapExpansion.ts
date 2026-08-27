'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 全画面のあいだ背後のページを止めるために body へ付けるクラス */
const BODY_CLASS = 'map-expanded';

/**
 * 現在地マップを画面いっぱいへ広げるモードの開閉。
 *
 * 表示の切り替えは CSS だけで完結させ、ネイティブ全画面はその上へ重ねる。
 * `requestFullscreen` は iOS Safari のように video 以外を受け付けない環境があり、
 * そこで何も起きないと困るためで、成否にかかわらず見た目は CSS 側で成立する。
 *
 * 対象の要素を動かさないのも決まりごとの一つ。地図を別のツリーへ移すと
 * MapLibre のインスタンスごと作り直しになり、タイルの取り直しと
 * 追従状態の消失が起きるため、クラスの付け外しだけで広げる。
 */
export function useMapExpansion() {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const expand = useCallback(() => {
    setIsExpanded(true);
    // クリック中に呼ぶのでユーザー操作として扱われる。
    // 使えない環境では例外になるだけなので、そのまま捨ててよい
    void panelRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (isExpanded) collapse();
    else expand();
  }, [collapse, expand, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    document.body.classList.add(BODY_CLASS);
    return () => document.body.classList.remove(BODY_CLASS);
  }, [isExpanded]);

  // Esc で抜ける。ネイティブ全画面が効いているときはブラウザが先に拾うため
  // ここへは届かないが、そちらは fullscreenchange 側で畳まれる
  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collapse, isExpanded]);

  // ネイティブ全画面から抜けたら CSS 側も畳む。
  // ブラウザ自身の終了ボタンなど、こちらの操作を経ない離脱があるため
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setIsExpanded(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return { isExpanded, panelRef, expand, collapse, toggle };
}
