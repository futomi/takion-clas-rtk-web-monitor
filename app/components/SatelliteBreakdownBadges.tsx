import { GNSS_SYSTEMS, GNSS_SYSTEM_ORDER, type SatelliteBreakdown } from '../lib/gnssSystem';

/** 衛星システム別の機数バッジ。取得できていない間はプレースホルダを出す */
export default function SatelliteBreakdownBadges({ breakdown }: { breakdown?: SatelliteBreakdown }) {
  const items = GNSS_SYSTEM_ORDER
    .map((key) => ({ key, count: breakdown?.[key] ?? 0, info: GNSS_SYSTEMS[key] }))
    .filter((item) => item.count > 0);

  if (items.length === 0) {
    return (
      <div className="sat-breakdown-empty">
        <span>内訳 取得中…</span>
      </div>
    );
  }

  return (
    <div className="sat-breakdown-row" aria-label="衛星種別内訳">
      {items.map((item) => (
        <span key={item.key} className={`sat-chip ${item.key}`} title={`${item.info.nameJa}: ${item.count}機`}>
          <span className="sat-chip-name">{item.info.short}</span>
          <span className="sat-chip-count">{item.count}</span>
        </span>
      ))}
    </div>
  );
}
