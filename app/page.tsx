import MonitorClient from './MonitorClient';
import type { NtripAvailability } from './lib/types';

/**
 * ネットワーク RTK の提供方針を、ビルド時の設定から決める。
 *
 * 静的書き出しには中継 API が含まれないため、開いた場所によらず提供できない。
 * そうでなければ既定はループバックからのアクセス時のみで、
 * VPS などで意図して中継を立てる場合に `NTRIP_ENABLED` で開ける。
 *
 * サーバーコンポーネントで読むためビルド時に確定する。実行時に切り替えたい場合は
 * ビルド時にも同じ値を渡す（API 側は実行時に読み直す）。
 */
const ntripAvailability: NtripAvailability =
  process.env.STATIC_EXPORT === 'true'
    ? 'none'
    : process.env.NTRIP_ENABLED === 'true'
      ? 'always'
      : 'loopback';

export default function Home() {
  return <MonitorClient ntripAvailability={ntripAvailability} />;
}
