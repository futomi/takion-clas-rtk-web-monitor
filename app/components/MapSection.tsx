'use client';

import { useMemo, useState } from 'react';
import { useLocalPlot } from '../hooks/useLocalPlot';
import { useMapExpansion } from '../hooks/useMapExpansion';
import type { TrackRecorder } from '../hooks/useTrackRecorder';
import { useTrackReplay } from '../hooks/useTrackReplay';
import { resolveQualityDisplay, type ActiveSource, type QualityDisplay } from '../lib/correctionSource';
import { formatValue } from '../lib/format';
import { hasPosition, type Telemetry } from '../lib/telemetry';
import { toTrackPoint, type TrackPoint } from '../lib/track';
import type { ConnectionState } from '../lib/types';
import LocalPlotPanel from './LocalPlotPanel';
import MapPanel from './MapPanel';
import TrackControls from './TrackControls';
import TrackNotice from './TrackNotice';

/**
 * 軌跡を隠しているときに地図へ渡す空の配列。
 * 毎回新しい配列を作ると、描き直す必要が無くても地図側の反映処理が動いてしまう。
 */
const NO_TRACK: TrackPoint[] = [];

/** 下段に出すもの。plot は原点まわり数 m を白紙に描く拡大プロット */
type MapView = 'map' | 'plot';

type MapSectionProps = {
  telemetry: Telemetry;
  activeSource: ActiveSource;
  quality: QualityDisplay;
  connection: ConnectionState;
  track: TrackRecorder;
  clock: number;
};

/**
 * 現在地マップのセクション。見出し・軌跡の記録操作・地図本体（または拡大プロット）をまとめる。
 *
 * 軌跡を描くかどうかはここで決める。操作するのは見出しの中の記録操作、
 * 反映されるのは地図本体で、その両方を持つのがこの層だけのため。
 *
 * 全画面表示もここが持つ。広がるのはこのセクションそのもので、
 * 中の見出しと地図の見せ方も一緒に変わるため。
 *
 * 地図と拡大プロットの切り替えもここ。どちらも同じ測位解を材料にし、
 * 見出しの状態表示と記録操作を共有する。
 */
export default function MapSection({ telemetry, activeSource, quality, connection, track, clock }: MapSectionProps) {
  const positioned = hasPosition(telemetry);
  const { isExpanded, panelRef, toggle } = useMapExpansion();
  const [view, setView] = useState<MapView>('map');

  /*
   * 拡大プロットへ流す最新の 1 点。
   * 記録ファイルを再生している間はそちらを、そうでなければ受信機の測位解を使う。
   * 入力元が切り替わったこと（と、再生の最初からのやり直し）は sourceKey の変化で
   * プロット側へ伝え、尾と原点を捨てさせる。
   *
   * 再生はこの層で持つ。地図へ切り替えている間も止めないためで、
   * 切り替えのたびに読み込み直させない。
   */
  const replay = useTrackReplay();
  const livePoint = useMemo(
    () => toTrackPoint(telemetry, telemetry.lastReceivedAt ?? 0),
    [telemetry],
  );
  const plot = useLocalPlot(
    replay.isActive ? replay.current : livePoint,
    replay.isActive ? `replay:${replay.session}` : 'live',
  );

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

  // 再生中のプロットを見ているときは、受信機ではなく再生位置の状態を見出しに出す。
  // 受信機の状態を出したままだと、画面の動きと見出しの「測位データ待ち」が食い違う
  const showsReplay = view === 'plot' && replay.isActive;
  const replayQuality = resolveQualityDisplay(plot.latest?.quality, '');

  return (
    <section
      ref={panelRef}
      className={`map-panel panel${isExpanded ? ' is-expanded' : ''}`}
      aria-label="現在地マップ"
    >
      <div className="map-panel-heading">
        <div className="map-panel-title">
          <h3>{view === 'map' ? '現在地マップ' : '拡大プロット'}</h3>
          <div className="map-panel-status">
            <span className={`fix-indicator ${showsReplay ? replayQuality.tone : quality.tone}`} />
            <span>
              {showsReplay
                ? `リプレイ · ${replayQuality.short} · ${replay.fileName}`
                : positioned
                  ? `${quality.short} · ${formatValue(telemetry.horizontalError, 2, ' m')} [${activeSource.badgeShort}]`
                  : '測位データ待ち'}
            </span>
          </div>

          {/*
            * 全画面では移動情報パネルも接続の状態も画面から消える。
            * 動きながら見失うと困るものだけを、ここへ引き継ぐ。
            * 再生中は受信機の速度・方位を出しても画面の動きと関係が無いので出さない。
            */}
          {isExpanded && !showsReplay && (
            <p className="map-hud-motion">
              <span>{formatValue(telemetry.speedKmh, 1, ' km/h')}</span>
              <span>{formatValue(telemetry.course, 1, '°')}</span>
            </p>
          )}
          {isExpanded && isDetached && !showsReplay && (
            <p className="map-hud-alert" role="status">受信機が未接続です</p>
          )}
        </div>

        {/*
          * 切り替えと全画面は記録操作より前に置く。記録操作は右詰めなので、後ろに置くと
          * 主ボタン（記録開始 / 停止）がパネルの右端から押し出されてしまう。
          */}
        <div className="map-view-switch" role="group" aria-label="表示の切り替え">
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>地図</button>
          <button type="button" aria-pressed={view === 'plot'} onClick={() => setView('plot')}>拡大プロット</button>
        </div>
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

      {/* 地図は隠すだけで外さない。MapLibre を作り直すとタイルの取り直しと追従状態の消失が起きる */}
      <div className="map-view" hidden={view !== 'map'}>
        <MapPanel
          latitude={telemetry.latitude}
          longitude={telemetry.longitude}
          horizontalError={telemetry.horizontalError}
          course={telemetry.course}
          qualityTone={quality.tone}
          track={showTrack ? track.points : NO_TRACK}
          isExpanded={isExpanded}
          isVisible={view === 'map'}
        />
      </div>
      {view === 'plot' && <LocalPlotPanel plot={plot} replay={replay} isExpanded={isExpanded} />}
    </section>
  );
}
