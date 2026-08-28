import MonitorClient from './MonitorClient';

/**
 * ネットワーク RTK を常に有効にするか。
 *
 * 既定ではループバックから開いたときだけ有効になる（{@link ./hooks/useIsLoopbackOrigin}）。
 * VPS などで意図して中継を立てる場合に、この環境変数で明示的に開ける。
 * サーバーコンポーネントで読むためビルド時に確定するので、実行時に切り替えたい場合は
 * ビルド時にも同じ値を渡す（API 側は実行時に読み直す）。
 */
const isNtripAlwaysEnabled = process.env.NTRIP_ENABLED === 'true';

export default function Home() {
  return <MonitorClient isNtripAlwaysEnabled={isNtripAlwaysEnabled} />;
}
