'use client';

import { useSyncExternalStore } from 'react';
import { getSerialApi } from '../lib/webSerial';

/**
 * 対応可否は実行中に変わらないため、購読は何もしない。
 *
 * 3 つの引数はいずれもモジュールスコープに置く。レンダーのたびに新しい関数を渡すと、
 * useSyncExternalStore が毎回購読し直してしまうため。
 */
const subscribe = () => () => {};
const getSnapshot = () => Boolean(getSerialApi());
const getServerSnapshot = () => false;

/**
 * SSR とクライアントで結果が食い違わないよう、Web Serial の対応可否を
 * useSyncExternalStore 経由で読む。サーバー側では常に未対応として描画する。
 */
export function useIsSerialSupported(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
