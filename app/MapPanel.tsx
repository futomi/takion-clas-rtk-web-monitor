'use client';

import type { FeatureCollection, Polygon } from 'geojson';
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

type MapPanelProps = {
  latitude?: number;
  longitude?: number;
  horizontalError?: number;
  course?: number;
  qualityTone: string;
};

type PositionFeatureCollection = FeatureCollection<Polygon>;

const JAPAN_CENTER: [number, number] = [138.2, 36.2];
const ACCURACY_SOURCE_ID = 'position-accuracy';

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

function createAccuracyCircle(longitude: number, latitude: number, radiusMeters: number): PositionFeatureCollection {
  const pointCount = 64;
  const latitudeRadians = latitude * Math.PI / 180;
  const metersPerLongitudeDegree = Math.max(1, 111_320 * Math.cos(latitudeRadians));
  const coordinates: [number, number][] = [];

  for (let index = 0; index <= pointCount; index += 1) {
    const angle = index / pointCount * Math.PI * 2;
    coordinates.push([
      longitude + Math.cos(angle) * radiusMeters / metersPerLongitudeDegree,
      latitude + Math.sin(angle) * radiusMeters / 110_574,
    ]);
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    }],
  };
}

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
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerElementRef = useRef<HTMLDivElement | null>(null);
  const centeredOnFirstFixRef = useRef(false);
  const errorTimerRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  const clearMapError = () => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setMapError('');
  };

  const showTemporaryError = (message: string) => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
    }
    setMapError(message);
    errorTimerRef.current = window.setTimeout(() => {
      setMapError('');
      errorTimerRef.current = null;
    }, 4000);
  };

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
  }, []);

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
      : { type: 'FeatureCollection', features: [] });

    if (!centeredOnFirstFixRef.current) {
      map.jumpTo({ center: [longitude, latitude], zoom: 17 });
      centeredOnFirstFixRef.current = true;
      return;
    }

    if (following) {
      map.easeTo({ center: [longitude, latitude], duration: 450, essential: true });
    }
  }, [course, following, horizontalError, latitude, longitude, mapLoaded, qualityTone]);

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
