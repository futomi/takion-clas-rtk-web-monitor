'use client';

import mapboxgl, { type GeoJSONSource, type Map as MapboxMap, type Marker } from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';

type MapPanelProps = {
  accessToken: string;
  tokenError?: string;
  latitude?: number;
  longitude?: number;
  horizontalError?: number;
  course?: number;
  qualityTone: string;
};

type PositionFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon>;

const JAPAN_CENTER: [number, number] = [138.2, 36.2];
const ACCURACY_SOURCE_ID = 'position-accuracy';

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
  accessToken,
  tokenError,
  latitude,
  longitude,
  horizontalError,
  course,
  qualityTone,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerElementRef = useRef<HTMLDivElement | null>(null);
  const centeredOnFirstFixRef = useRef(false);
  const positionRef = useRef({ latitude, longitude });
  const [following, setFollowing] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  positionRef.current = { latitude, longitude };

  useEffect(() => {
    if (!accessToken || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = accessToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: JAPAN_CENTER,
      zoom: 4.4,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    const stopFollowing = () => setFollowing(false);
    map.on('dragstart', stopFollowing);
    map.on('rotatestart', stopFollowing);
    map.on('pitchstart', stopFollowing);
    map.on('error', (event) => {
      if (event.error?.message) {
        setMapError('地図を読み込めませんでした。Mapboxのトークンと許可URLを確認してください。');
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
      markerRef.current = new mapboxgl.Marker({
        element: markerElement,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      });
      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      markerElementRef.current = null;
    };
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!mapLoaded || !map || !marker || latitude === undefined || longitude === undefined) return;

    marker.setLngLat([longitude, latitude]);
    if (!marker.getElement().parentElement) marker.addTo(map);
    marker.setRotation(course ?? 0);

    if (markerElementRef.current) {
      markerElementRef.current.className = `map-position-marker ${qualityTone}`;
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
    const current = positionRef.current;
    if (map && current.latitude !== undefined && current.longitude !== undefined) {
      map.easeTo({ center: [current.longitude, current.latitude], zoom: Math.max(map.getZoom(), 16), duration: 600, essential: true });
    }
  };

  const configurationMessage = tokenError ?? (!accessToken
    ? 'Mapboxアクセストークンが設定されていません。'
    : '');

  if (configurationMessage) {
    return (
      <div className="map-configuration" role="status">
        <span className="map-configuration-mark" aria-hidden="true" />
        <div><strong>地図を表示できません</strong><p>{configurationMessage}</p></div>
      </div>
    );
  }

  return (
    <div className="map-canvas-wrap">
      <div ref={containerRef} className="map-canvas" />
      {!mapLoaded && <div className="map-loading">地図を読み込んでいます…</div>}
      {mapError && <div className="map-error" role="alert">{mapError}</div>}
      {mapLoaded && latitude === undefined && longitude === undefined && (
        <div className="map-waiting"><span className="status-dot" />測位データを待っています</div>
      )}
      {mapLoaded && latitude !== undefined && longitude !== undefined && !following && (
        <button className="map-follow-button" type="button" onClick={resumeFollowing}>現在地を追従</button>
      )}
    </div>
  );
}
