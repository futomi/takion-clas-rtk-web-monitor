import { formatLogTime } from '../lib/format';

/** ログ行の受信時刻表示 */
export default function LogTimestamp({ receivedAt }: { receivedAt: number }) {
  return <time dateTime={new Date(receivedAt).toISOString()}>{formatLogTime(receivedAt)}</time>;
}
