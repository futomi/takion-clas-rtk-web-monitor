'use client';

import { useSyncExternalStore } from 'react';
import { isLoopbackHost } from '../lib/localHost';

/**
 * 表示中の URL は実行中に変わらないため、購読は何もしない。
 * 3 つの引数はいずれもモジュールスコープに置く（{@link ./useIsSerialSupported} と同じ理由）。
 */
const subscribe = () => () => {};
const getSnapshot = () => isLoopbackHost(window.location.host);
const getServerSnapshot = () => false;

/**
 * このページがローカル（ループバック）から配信されているか。
 *
 * SSR とクライアントで結果が食い違わないよう useSyncExternalStore 経由で読む。
 * サーバー側では常に false として描画する。
 *
 * 使い道は表示の出し分けだけで、防御ではない。実際の遮断は API 側が
 * {@link ../lib/server/ntripAvailability} で行う。
 */
export function useIsLoopbackOrigin(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
