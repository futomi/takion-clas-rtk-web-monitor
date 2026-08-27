'use client';

import { useState } from 'react';
import type { TrackRecorder } from '../hooks/useTrackRecorder';
import type { ActiveSource, QualityDisplay } from '../lib/correctionSource';
import { formatValue } from '../lib/format';
import { hasPosition, type Telemetry } from '../lib/telemetry';
import type { TrackPoint } from '../lib/track';
import MapPanel from './MapPanel';
import TrackControls from './TrackControls';
import TrackNotice from './TrackNotice';

/**
 * 軌跡を隠しているときに地図へ渡す空の配列。
 * 毎回新しい配列を作ると、描き直す必要が無くても地図側の反映処理が動いてしまう。
 */
const NO_TRACK: TrackPoint[] = [];

type MapSectionProps = {
  telemetry: Telemetry;
  activeSource: ActiveSource;
  quality: QualityDisplay;
  track: TrackRecorder;
  clock: number;
};

/**
 * 現在地マップのセクション。見出し・軌跡の記録操作・地図本体をまとめる。
 *
 * 軌跡を描くかどうかはここで決める。操作するのは見出しの中の記録操作、
 * 反映されるのは地図本体で、その両方を持つのがこの層だけのため。
 */
export default function MapSection({ telemetry, activeSource, quality, track, clock }: MapSectionProps) {
  const positioned = hasPosition(telemetry);

  /**
   * 「隠す」と指示された軌跡の始点時刻。隠していなければ null。
   *
   * 真偽値ではなくどの軌跡を隠したかで持つのは、表示状態を自動で戻すため。
   * 記録を消して別の軌跡を始めれば始点が変わり、指示は自然に効かなくなる。
   * 隠したままだと、次に記録しても線が出ない理由が画面から読み取れない。
   */
  const [hiddenTrackStart, setHiddenTrackStart] = useState<number | null>(null);
  const trackStart = track.points.length > 0 ? track.points[0].at : null;
  const showTrack = trackStart === null || hiddenTrackStart !== trackStart;

  return (
    <section className="map-panel panel" aria-label="現在地マップ">
      <div className="map-panel-heading">
        <div className="map-panel-title">
          <h3>現在地マップ</h3>
          <div className="map-panel-status">
            <span className={`fix-indicator ${quality.tone}`} />
            <span>
              {positioned
                ? `${quality.short} · ${formatValue(telemetry.horizontalError, 2, ' m')} [${activeSource.badgeShort}]`
                : '測位データ待ち'}
            </span>
          </div>
        </div>
        <TrackControls
          track={track}
          clock={clock}
          showTrack={showTrack}
          onToggleTrack={() => setHiddenTrackStart(showTrack ? trackStart : null)}
        />
      </div>
      <TrackNotice track={track} />
      <MapPanel
        latitude={telemetry.latitude}
        longitude={telemetry.longitude}
        horizontalError={telemetry.horizontalError}
        course={telemetry.course}
        qualityTone={quality.tone}
        track={showTrack ? track.points : NO_TRACK}
      />
    </section>
  );
}
