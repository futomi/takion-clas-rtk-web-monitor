'use client';

import { useEffect, useState } from 'react';

/** 経過時間表示を更新する間隔（ms） */
const CLOCK_INTERVAL_MS = 1000;

/**
 * 経過時間表示のために毎秒進む時計。
 * サーバー描画時は 0 を返し、マウント後に実時刻へ切り替わる。
 */
export function useClock(): number {
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return clock;
}
