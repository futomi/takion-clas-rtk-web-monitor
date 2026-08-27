'use client';

import { useState } from 'react';
import { useMapExpansion } from '../hooks/useMapExpansion';
import type { TrackRecorder } from '../hooks/useTrackRecorder';
import type { ActiveSource, QualityDisplay } from '../lib/correctionSource';
import { formatValue } from '../lib/format';
import { hasPosition, type Telemetry } from '../lib/telemetry';
import type { TrackPoint } from '../lib/track';
import type { ConnectionState } from '../lib/types';
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
  connection: ConnectionState;
  track: TrackRecorder;
  clock: number;
};

/**
 * 現在地マップのセクション。見出し・軌跡の記録操作・地図本体をまとめる。
 *
 * 軌跡を描くかどうかはここで決める。操作するのは見出しの中の記録操作、
 * 反映されるのは地図本体で、その両方を持つのがこの層だけのため。
 *
 * 全画面表示もここが持つ。広がるのはこのセクションそのもので、
 * 中の見出しと地図の見せ方も一緒に変わるため。
 */
export default function MapSection({ telemetry, activeSource, quality, connection, track, clock }: MapSectionProps) {
  const positioned = hasPosition(telemetry);
  const { isExpanded, panelRef, toggle } = useMapExpansion();

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

  // 接続を試みている最中は出さない。数秒で決着するものを警告として出すと、
  // 毎回の接続でひととおり赤い帯が流れることになる
  const isDetached = connection === 'idle' || connection === 'disconnecting';

  return (
    <section
      ref={panelRef}
      className={`map-panel panel${isExpanded ? ' is-expanded' : ''}`}
      aria-label="現在地マップ"
    >
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

          {/*
            * 全画面では移動情報パネルも接続の状態も画面から消える。
            * 動きながら見失うと困るものだけを、ここへ引き継ぐ。
            */}
          {isExpanded && (
            <p className="map-hud-motion">
              <span>{formatValue(telemetry.speedKmh, 1, ' km/h')}</span>
              <span>{formatValue(telemetry.course, 1, '°')}</span>
            </p>
          )}
          {isExpanded && isDetached && (
            <p className="map-hud-alert" role="status">受信機が未接続です</p>
          )}
        </div>

        {/*
          * 記録操作より前に置く。記録操作は右詰めなので、後ろに置くと
          * 主ボタン（記録開始 / 停止）がパネルの右端から押し出されてしまう。
          */}
        <button type="button" className="map-expand-button" onClick={toggle}>
          {isExpanded ? '全画面を解除' : '全画面'}
        </button>

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
        isExpanded={isExpanded}
      />
    </section>
  );
}
