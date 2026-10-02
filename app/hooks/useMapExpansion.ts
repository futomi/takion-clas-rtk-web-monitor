'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 広げている間、背後のページを止めるために body へ付けるクラス */
const BODY_CLASS = 'map-expanded';

/**
 * 現在地マップの広げ方。
 *
 * - `window`: ブラウザの表示領域いっぱいに広げる（最大化）。タブやアドレスバー、
 *   ほかのウィンドウはそのまま見えるので、別の作業と並べて使える
 * - `fullscreen`: 上に加えてネイティブ全画面を重ね、画面全体を地図にする
 */
export type MapExpansion = 'none' | 'window' | 'fullscreen';

/**
 * 現在地マップを広げるモードの開閉。
 *
 * 表示の切り替えはどちらのモードも CSS だけで完結させ、全画面のときだけ
 * ネイティブ全画面をその上へ重ねる。`requestFullscreen` は iOS Safari のように
 * video 以外を受け付けない環境があり、そこで何も起きないと困るためで、
 * 成否にかかわらず見た目は CSS 側で成立する。
 *
 * 対象の要素を動かさないのも決まりごとの一つ。地図を別のツリーへ移すと
 * MapLibre のインスタンスごと作り直しになり、タイルの取り直しと
 * 追従状態の消失が起きるため、クラスの付け外しだけで広げる。
 */
export function useMapExpansion() {
  const [expansion, setExpansion] = useState<MapExpansion>('none');
  const panelRef = useRef<HTMLElement | null>(null);
  const isExpanded = expansion !== 'none';

  const expand = useCallback((next: Exclude<MapExpansion, 'none'>) => {
    setExpansion(next);
    if (next === 'fullscreen') {
      // クリック中に呼ぶのでユーザー操作として扱われる。
      // 使えない環境では例外になるだけなので、そのまま捨ててよい
      void panelRef.current?.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      // 全画面から最大化へ移るときは、ネイティブ全画面だけを抜ける。
      // 抜けたことは fullscreenchange で届くが、その時点で状態はもう window なので畳まれない
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const collapse = useCallback(() => {
    setExpansion('none');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  /** 指定のモードへ広げる。すでにそのモードなら元へ戻す */
  const toggle = useCallback((target: Exclude<MapExpansion, 'none'>) => {
    if (expansion === target) collapse();
    else expand(target);
  }, [collapse, expand, expansion]);

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
  // ブラウザ自身の終了ボタンなど、こちらの操作を経ない離脱があるため。
  // 最大化へ移るために抜けた場合は、状態がすでに window になっているので触らない
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setExpansion((current) => (current === 'fullscreen' ? 'none' : current));
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return { expansion, isExpanded, panelRef, expand, collapse, toggle };
}
