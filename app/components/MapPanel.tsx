'use client';

import {
  AttributionControl,
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useTemporaryMessage } from '../hooks/useTemporaryMessage';
import { MAP_ERROR_DURATION_MS } from '../lib/constants';
import type { QualityTone } from '../lib/correctionSource';
import { EMPTY_FEATURE_COLLECTION, createAccuracyCircle } from '../lib/geo';
import { buildTrackFeatures, buildTrackStartFeature, type TrackPoint } from '../lib/track';

type MapPanelProps = {
  latitude?: number;
  longitude?: number;
  horizontalError?: number;
  course?: number;
  qualityTone: QualityTone;
  /** 記録中の軌跡。空配列なら何も描かない */
  track: TrackPoint[];
  /** 地図を画面いっぱいへ広げているか。操作方法の切り替えに使う */
  isExpanded: boolean;
};

const JAPAN_CENTER: [number, number] = [138.2, 36.2];
const ACCURACY_SOURCE_ID = 'position-accuracy';
const TRACK_SOURCE_ID = 'track-line';
const TRACK_START_SOURCE_ID = 'track-start';

/**
 * 軌跡の測位品質ごとの色。
 *
 * 地図ライブラリの paint 指定は CSS 変数を読めないため、
 * map.css のマーカー色と同じ値をここにも書いている。
 * 値の出どころは base.css のブランド ramp と分類色トークン。
 */
const TRACK_LINE_COLOR: DataDrivenPropertyValueSpecification<string> = [
  'match', ['get', 'tone'],
  'fix', '#219e70',
  'float', '#ca5010',
  'single', '#3aae81',
  '#9e9e9e',
];

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
    },
  ],
};

function createMarkerElement() {
  const marker = document.createElement('div');
  marker.className = 'map-position-marker none';
  marker.setAttribute('aria-label', 'GNSS受信機から取得した現在地');

  const heading = document.createElement('span');
  heading.className = 'map-position-heading';
  heading.setAttribute('aria-hidden', 'true');
  marker.appendChild(heading);

  const dot = document.createElement('span');
  dot.className = 'map-position-dot';
  dot.setAttribute('aria-hidden', 'true');
  marker.appendChild(dot);
  return marker;
}

export default function MapPanel({
  latitude,
  longitude,
  horizontalError,
  course,
  qualityTone,
  track,
  isExpanded,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerElementRef = useRef<HTMLDivElement | null>(null);
  const centeredOnFirstFixRef = useRef(false);
  const [following, setFollowing] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const {
    message: mapError,
    show: showTemporaryError,
    clear: clearMapError,
  } = useTemporaryMessage(MAP_ERROR_DURATION_MS);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: JAPAN_CENTER,
      zoom: 4.4,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    const stopFollowing = () => setFollowing(false);
    map.on('dragstart', stopFollowing);
    map.on('rotatestart', stopFollowing);
    map.on('pitchstart', stopFollowing);
    map.on('zoomstart', clearMapError);
    map.on('error', (event) => {
      if (event.error?.message) {
        showTemporaryError('地図タイルの読み込みに失敗しました。ネットワーク接続を確認してください。');
      }
    });

    map.on('load', () => {
      // 軌跡は誤差円より先に追加して下に敷く。
      // 現在地まわりの精度表示が、通ってきた線に隠れないようにするため
      map.addSource(TRACK_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${TRACK_SOURCE_ID}-layer`,
        type: 'line',
        source: TRACK_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': TRACK_LINE_COLOR,
          'line-width': 3.5,
          'line-opacity': 0.85,
        },
      });

      map.addSource(TRACK_START_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${TRACK_START_SOURCE_ID}-layer`,
        type: 'circle',
        source: TRACK_START_SOURCE_ID,
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#0f6a4c',
        },
      });

      map.addSource(ACCURACY_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${ACCURACY_SOURCE_ID}-fill`,
        type: 'fill',
        source: ACCURACY_SOURCE_ID,
        paint: { 'fill-color': '#0f6a4c', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: `${ACCURACY_SOURCE_ID}-line`,
        type: 'line',
        source: ACCURACY_SOURCE_ID,
        paint: { 'line-color': '#0f6a4c', 'line-width': 1.5, 'line-opacity': 0.7 },
      });

      const markerElement = createMarkerElement();
      markerElementRef.current = markerElement;
      markerRef.current = new Marker({
        element: markerElement,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      });
      setMapLoaded(true);
    });

    return () => {
      clearMapError();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      markerElementRef.current = null;
    };
  }, [clearMapError, showTemporaryError]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!mapLoaded || !map || !marker || latitude === undefined || longitude === undefined) return;

    marker.setLngLat([longitude, latitude]);
    if (!marker.getElement().parentElement) marker.addTo(map);
    marker.setRotation(course ?? 0);

    if (markerElementRef.current) {
      markerElementRef.current.className = `map-position-marker ${qualityTone} ${course !== undefined ? 'has-heading' : 'no-heading'}`;
    }

    const source = map.getSource(ACCURACY_SOURCE_ID) as GeoJSONSource | undefined;
    const radius = horizontalError !== undefined && horizontalError > 0 ? horizontalError : 0;
    source?.setData(radius > 0
      ? createAccuracyCircle(longitude, latitude, radius)
      : EMPTY_FEATURE_COLLECTION);

    if (!centeredOnFirstFixRef.current) {
      map.jumpTo({ center: [longitude, latitude], zoom: 17 });
      centeredOnFirstFixRef.current = true;
      return;
    }

    if (following) {
      map.easeTo({ center: [longitude, latitude], duration: 450, essential: true });
    }
  }, [course, following, horizontalError, latitude, longitude, mapLoaded, qualityTone]);

  /*
   * 全画面のときは Ctrl + ホイール（二本指）の強制を外す。
   *
   * この制限はページのスクロールを地図に横取りさせないためのもので、
   * 地図が画面そのものになれば守るべきスクロールが無くなる。
   * 残したままだと、拡大縮小のたびに修飾キーを要求されるだけになってしまう。
   *
   * 併せて大きさも取り直す。既定の trackResize でも追従するが、
   * こちらは切り替えた直後の同じ描画で反映され、伸びた一瞬が出ない。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    if (isExpanded) map.cooperativeGestures.disable();
    else map.cooperativeGestures.enable();
    map.resize();
  }, [isExpanded, mapLoaded]);

  // 軌跡の反映。点が積まれるのは記録間隔ごと（既定 1 秒）なので、
  // 配列の入れ替わりに合わせてそのまま描き直して差し支えない。
  // 非表示のときは呼び出し側が空の配列を渡すため、ここでは何も気にしなくてよい
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    (map.getSource(TRACK_SOURCE_ID) as GeoJSONSource | undefined)?.setData(buildTrackFeatures(track));
    (map.getSource(TRACK_START_SOURCE_ID) as GeoJSONSource | undefined)?.setData(buildTrackStartFeature(track));
  }, [mapLoaded, track]);

  const resumeFollowing = () => {
    setFollowing(true);
    const map = mapRef.current;
    if (map && latitude !== undefined && longitude !== undefined) {
      map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 16), duration: 600, essential: true });
    }
  };

  return (
    <div className="map-canvas-wrap">
      <div ref={containerRef} className="map-canvas" />
      {!mapLoaded && <div className="map-loading">地図を読み込んでいます…</div>}
      {mapError && (
        <div className="map-error" role="alert">
          <span>{mapError}</span>
          <button type="button" className="map-error-close" onClick={clearMapError} aria-label="エラーを閉じる">×</button>
        </div>
      )}
      {mapLoaded && latitude === undefined && longitude === undefined && (
        <div className="map-waiting"><span className="status-dot" />測位データを待っています</div>
      )}
      {mapLoaded && latitude !== undefined && longitude !== undefined && !following && (
        <button className="map-follow-button" type="button" onClick={resumeFollowing}>現在地を追従</button>
      )}
    </div>
  );
}
