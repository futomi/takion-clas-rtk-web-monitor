'use client';

import { useSyncExternalStore } from 'react';
import { getSerialApi } from '../lib/webSerial';

/**
 * SSR とクライアントで結果が食い違わないよう、Web Serial の対応可否を
 * useSyncExternalStore 経由で読む。サーバー側では常に未対応として描画する。
 */
export function useIsSerialSupported(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => Boolean(getSerialApi()),
    () => false,
  );
}
