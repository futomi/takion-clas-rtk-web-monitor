'use client';

import type { ActiveSource, QualityDisplay } from '../lib/correctionSource';
import { formatValue } from '../lib/format';
import { hasPosition, type Telemetry } from '../lib/telemetry';
import MapPanel from './MapPanel';

type MapSectionProps = {
  telemetry: Telemetry;
  activeSource: ActiveSource;
  quality: QualityDisplay;
};

/** 現在地マップのセクション。見出しと地図本体をまとめる */
export default function MapSection({ telemetry, activeSource, quality }: MapSectionProps) {
  const positioned = hasPosition(telemetry);

  return (
    <section className="map-panel panel" aria-label="現在地マップ">
      <div className="map-panel-heading">
        <div>
          <h3>現在地マップ</h3>
        </div>
        <div className="map-panel-status">
          <span className={`fix-indicator ${quality.tone}`} />
          <span>
            {positioned
              ? `${quality.short} · ${formatValue(telemetry.horizontalError, 2, ' m')} [${activeSource.badgeShort}]`
              : '測位データ待ち'}
          </span>
        </div>
      </div>
      <MapPanel
        latitude={telemetry.latitude}
        longitude={telemetry.longitude}
        horizontalError={telemetry.horizontalError}
        course={telemetry.course}
        qualityTone={quality.tone}
      />
    </section>
  );
}
