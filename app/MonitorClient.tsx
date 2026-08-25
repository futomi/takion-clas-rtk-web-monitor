'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import MapPanel from './MapPanel';
import {
  MessageCategory,
  getMessageDefinition,
  formatNmeaSummary,
  getAllMessageDefinitions,
  SatelliteBreakdown,
  GNSS_SYSTEMS,
  GNSS_SYSTEM_ORDER,
  getGnssSystemFromTalker,
  identifyGnssSystem,
} from './lib/gnssMessages';

type SerialPortInfo = { usbVendorId?: number; usbProductId?: number };
type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; bufferSize?: number; flowControl?: 'none' | 'hardware' }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
};
type SerialApi = { requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike> };
type Telemetry = {
  latitude?: number; longitude?: number; altitude?: number; geoidSeparation?: number;
  quality?: number; satellitesUsed?: number; satellitesInView?: number;
  satellitesUsedBreakdown?: SatelliteBreakdown;
  satellitesInViewBreakdown?: SatelliteBreakdown;
  hdop?: number; pdop?: number; vdop?: number; speedKmh?: number; course?: number;
  timeUtc?: string; dateUtc?: string; horizontalError?: number; verticalError?: number;
  lastReceivedAt?: number;
};
type ParsedLine = {
  type: string;
  valid: boolean | null;
  update: Partial<Telemetry>;
  summary?: string;
  gsvTalker?: string;
  gsvCount?: number;
  gsvPrns?: number[];
  gsaTalker?: string;
  gsaSystemId?: number;
  gsaPrns?: number[];
};
type LogLine = {
  id: number;
  receivedAt: number;
  text: string;
  type: string;
  valid: boolean | null;
  titleJa: string;
  category: MessageCategory;
  categoryJa: string;
  meaning: string;
  rawText: string;
};
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

type CorrectionMode = 'clas' | 'ntrip' | 'none';
type NtripStatus = 'idle' | 'fetching_sources' | 'connecting' | 'connected' | 'error';

export type MountpointRecord = {
  mountpoint: string;
  identifier: string;
  format: string;
  formatDetails: string;
  carrier: number;
  navSystem: string;
  network: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  nmea: boolean;
  solution: number;
  generator: string;
  authentication: string;
  fee: boolean;
  bitrate: number;
};

type MountpointCandidate = MountpointRecord & {
  distanceKm: number | null;
};

type SavedNtripConfig = {
  host?: string;
  port?: number;
  mountpoint?: string;
  username?: string;
  password?: string;
  autoSelect?: boolean;
};

const UBLOX_VENDOR_ID = 0x1546;
const DEFAULT_MAX_LOGS = 250;
const LOG_LIMIT_OPTIONS = [100, 250, 500, 1000] as const;
const MAX_NMEA_BYTES = 256;
const MAX_UBX_PAYLOAD_BYTES = 16384;
const GET_NAV_PVT_USB_RATE = new Uint8Array([0xb5, 0x62, 0x06, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x53, 0xf7]);
const ENABLE_NAV_PVT_USB_RAM = new Uint8Array([0xb5, 0x62, 0x06, 0x8a, 0x09, 0x00, 0x00, 0x01, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x01, 0x55, 0x52]);
const DISABLE_NAV_PVT_USB_RAM = new Uint8Array([0xb5, 0x62, 0x06, 0x8a, 0x09, 0x00, 0x00, 0x01, 0x00, 0x00, 0x09, 0x00, 0x91, 0x20, 0x00, 0x54, 0x51]);

const qualityLabels: Record<number, { label: string; short: string; tone: string }> = {
  0: { label: '測位できていません', short: 'NO FIX', tone: 'none' },
  1: { label: '単独測位', short: '3D FIX', tone: 'single' },
  2: { label: 'DGPS測位', short: 'DGPS', tone: 'float' },
  4: { label: '高精度測位（Fix）', short: 'FIX', tone: 'fix' },
  5: { label: '高精度測位（Float）', short: 'FLOAT', tone: 'float' },
  6: { label: '推測航法', short: 'DR', tone: 'single' },
};

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球の半径 km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCoordinate(value: string | undefined, hemisphere: string | undefined) {
  const raw = parseNumber(value);
  if (raw === undefined || !hemisphere) return undefined;
  const degrees = Math.floor(raw / 100);
  const minutes = raw - degrees * 100;
  const decimal = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal;
}

function formatNmeaTime(value: string | undefined) {
  if (!value || value.length < 6) return undefined;
  const fraction = value.includes('.') ? `.${value.split('.')[1]}` : '';
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}${fraction}`;
}

function formatNmeaDate(value: string | undefined) {
  if (!value || value.length !== 6) return undefined;
  const year = Number(value.slice(4, 6));
  const fullYear = year >= 80 ? 1900 + year : 2000 + year;
  return `${fullYear}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
}

function checksumIsValid(line: string) {
  const star = line.indexOf('*');
  if (!line.startsWith('$') || star < 0 || star + 2 >= line.length) return null;
  let checksum = 0;
  for (let index = 1; index < star; index += 1) checksum ^= line.charCodeAt(index);
  const expected = Number.parseInt(line.slice(star + 1, star + 3), 16);
  return Number.isFinite(expected) ? checksum === expected : false;
}

function isNmeaSentence(bytes: Uint8Array, decoder: TextDecoder) {
  if (bytes.length < 10 || bytes.length > MAX_NMEA_BYTES) return null;
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) return null;
  }
  const text = decoder.decode(bytes);
  if (!/^\$[A-Z][A-Z0-9]{3,5},.*\*[0-9A-F]{2}$/i.test(text)) return null;
  return text;
}

function parseNmea(line: string): ParsedLine {
  const valid = checksumIsValid(line);
  const payload = line.slice(1, line.indexOf('*') > -1 ? line.indexOf('*') : undefined);
  const fields = payload.split(',');
  const sentence = fields[0] ?? '';
  const type = sentence.length >= 3 ? sentence.slice(-3) : 'RAW';
  const update: Partial<Telemetry> = {};
  if (!line.startsWith('$')) return { type: 'RAW', valid: null, update };

  switch (type) {
    case 'GGA':
      update.timeUtc = formatNmeaTime(fields[1]);
      update.quality = parseNumber(fields[6]) ?? 0;
      update.satellitesUsed = parseNumber(fields[7]);
      if (update.quality > 0) {
        update.latitude = parseCoordinate(fields[2], fields[3]);
        update.longitude = parseCoordinate(fields[4], fields[5]);
        update.hdop = parseNumber(fields[8]);
        update.altitude = parseNumber(fields[9]);
        update.geoidSeparation = parseNumber(fields[11]);
      } else {
        update.latitude = undefined;
        update.longitude = undefined;
        update.hdop = undefined;
        update.altitude = undefined;
        update.geoidSeparation = undefined;
        update.horizontalError = undefined;
        update.verticalError = undefined;
      }
      break;
    case 'RMC': {
      if (fields[2] === 'A') {
        update.latitude = parseCoordinate(fields[3], fields[4]);
        update.longitude = parseCoordinate(fields[5], fields[6]);
      }
      const speedKnots = parseNumber(fields[7]);
      update.speedKmh = speedKnots === undefined ? undefined : speedKnots * 1.852;
      update.course = parseNumber(fields[8]);
      update.dateUtc = formatNmeaDate(fields[9]);
      update.timeUtc = formatNmeaTime(fields[1]);
      break;
    }
    case 'GSA': {
      update.pdop = parseNumber(fields[15]);
      update.hdop = parseNumber(fields[16]);
      update.vdop = parseNumber(fields[17]);
      const talker = sentence.length > 3 ? sentence.slice(0, sentence.length - 3) : 'GN';
      const systemId = parseNumber(fields[18]);
      const prns: number[] = [];
      for (let i = 3; i <= 14; i += 1) {
        const prn = parseNumber(fields[i]);
        if (prn !== undefined && prn > 0) {
          prns.push(prn);
        }
      }
      return { type, valid, update, gsaTalker: talker, gsaSystemId: systemId, gsaPrns: prns };
    }
    case 'GSV': {
      const talker = sentence.length > 3 ? sentence.slice(0, sentence.length - 3) : 'GN';
      const count = parseNumber(fields[3]);
      const prns: number[] = [];
      for (let i = 4; i + 3 < fields.length; i += 4) {
        const prn = parseNumber(fields[i]);
        if (prn !== undefined && prn > 0) {
          prns.push(prn);
        }
      }
      return { type, valid, update, gsvTalker: talker, gsvCount: count, gsvPrns: prns };
    }
    case 'GST': {
      const latitudeSigma = parseNumber(fields[6]);
      const longitudeSigma = parseNumber(fields[7]);
      if (latitudeSigma !== undefined && longitudeSigma !== undefined) update.horizontalError = Math.hypot(latitudeSigma, longitudeSigma);
      update.verticalError = parseNumber(fields[8]);
      break;
    }
    case 'VTG':
      update.course = parseNumber(fields[1]);
      update.speedKmh = parseNumber(fields[7]);
      break;
    case 'ZDA':
      update.timeUtc = formatNmeaTime(fields[1]);
      if (fields[2] && fields[3] && fields[4]) update.dateUtc = `${fields[4]}-${fields[3].padStart(2, '0')}-${fields[2].padStart(2, '0')}`;
      break;
  }
  return { type, valid, update };
}

function parseUbx(frame: Uint8Array): ParsedLine {
  const messageClass = frame[2];
  const messageId = frame[3];
  const payloadLength = frame[4] | (frame[5] << 8);
  let checksumA = 0;
  let checksumB = 0;
  for (let index = 2; index < frame.length - 2; index += 1) {
    checksumA = (checksumA + frame[index]) & 0xff;
    checksumB = (checksumB + checksumA) & 0xff;
  }
  const valid = frame[frame.length - 2] === checksumA && frame[frame.length - 1] === checksumB;
  const type = messageClass === 0x01 && messageId === 0x07
    ? 'PVT'
    : messageClass === 0x02 && messageId === 0x73
      ? 'QZSSL6'
      : messageClass === 0x06 && messageId === 0x8b
        ? 'CFG-VALGET'
        : messageClass === 0x05 && messageId === 0x01
          ? 'ACK-ACK'
          : messageClass === 0x05 && messageId === 0x00
            ? 'ACK-NAK'
            : `${messageClass.toString(16).toUpperCase().padStart(2, '0')}/${messageId.toString(16).toUpperCase().padStart(2, '0')}`;
  const update: Partial<Telemetry> = {};

  if (!valid) return { type, valid, update };

  if (messageClass === 0x05 && payloadLength >= 2) {
    const targetClass = frame[6].toString(16).toUpperCase().padStart(2, '0');
    const targetId = frame[7].toString(16).toUpperCase().padStart(2, '0');
    return { type, valid, update, summary: `UBX-${type} · command ${targetClass}/${targetId}` };
  }

  if (type === 'QZSSL6' && payloadLength >= 14) {
    const data = new DataView(frame.buffer, frame.byteOffset + 6, payloadLength);
    const svId = data.getUint8(1);
    const cno = data.getUint16(2, true) / 256;
    const channelInfo = data.getUint16(10, true);
    const signal = (channelInfo & (1 << 10)) !== 0 ? 'L6E' : 'L6D';
    return { type, valid, update, summary: `UBX-RXM-QZSSL6 · ${signal} / SV ${svId} / C/N0 ${cno.toFixed(1)} dBHz` };
  }

  if (type !== 'PVT' || payloadLength < 92) return { type, valid, update };

  const data = new DataView(frame.buffer, frame.byteOffset + 6, payloadLength);
  const fixType = data.getUint8(20);
  const flags = data.getUint8(21);
  const carrierSolution = (flags >> 6) & 0x03;
  const hasFix = (flags & 0x01) !== 0 && fixType >= 2;
  const hasDifferential = (flags & 0x02) !== 0;

  update.quality = !hasFix ? 0 : carrierSolution === 2 ? 4 : carrierSolution === 1 ? 5 : hasDifferential ? 2 : 1;
  update.satellitesUsed = data.getUint8(23);
  if (hasFix) {
    update.longitude = data.getInt32(24, true) * 1e-7;
    update.latitude = data.getInt32(28, true) * 1e-7;
    const ellipsoidHeight = data.getInt32(32, true) / 1000;
    update.altitude = data.getInt32(36, true) / 1000;
    update.geoidSeparation = ellipsoidHeight - update.altitude;
    const horizontalError = data.getUint32(40, true);
    const verticalError = data.getUint32(44, true);
    update.horizontalError = horizontalError === 0xffffffff ? undefined : horizontalError / 1000;
    update.verticalError = verticalError === 0xffffffff ? undefined : verticalError / 1000;
    update.speedKmh = data.getInt32(60, true) * 0.0036;
    update.course = data.getInt32(64, true) * 1e-5;
    const pdop = data.getUint16(76, true);
    update.pdop = pdop === 0xffff ? undefined : pdop * 0.01;
  } else {
    update.latitude = undefined;
    update.longitude = undefined;
    update.altitude = undefined;
    update.geoidSeparation = undefined;
    update.horizontalError = undefined;
    update.verticalError = undefined;
    update.speedKmh = undefined;
    update.course = undefined;
    update.pdop = undefined;
  }

  const timeValid = data.getUint8(11);
  if ((timeValid & 0x03) === 0x03) {
    const year = data.getUint16(4, true);
    const month = data.getUint8(6);
    const day = data.getUint8(7);
    const hour = data.getUint8(8);
    const minute = data.getUint8(9);
    const second = data.getUint8(10);
    update.dateUtc = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    update.timeUtc = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  return { type, valid, update };
}

function crc24q(bytes: Uint8Array, end: number) {
  let crc = 0;
  for (let index = 0; index < end; index += 1) {
    crc ^= bytes[index] << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if ((crc & 0x1000000) !== 0) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

function parseRtcm(frame: Uint8Array): ParsedLine {
  const expected = (frame[frame.length - 3] << 16) | (frame[frame.length - 2] << 8) | frame[frame.length - 1];
  const valid = crc24q(frame, frame.length - 3) === expected;
  const messageType = frame.length >= 5 ? (frame[3] << 4) | (frame[4] >> 4) : 0;
  const type = messageType > 0 ? `RTCM${messageType}` : 'RTCM3';
  return { type, valid, update: {}, summary: `RTCM3 type ${messageType || 'unknown'} · ${frame.length - 6} byte payload` };
}

function formatValue(value: number | undefined, digits = 2, suffix = '') {
  return value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`;
}

function formatHex(value: number | undefined) {
  return value === undefined ? '—' : `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function SatelliteBreakdownBadges({ breakdown }: { breakdown?: SatelliteBreakdown }) {
  if (!breakdown) {
    return (
      <div className="sat-breakdown-empty">
        <span>内訳 取得中…</span>
      </div>
    );
  }
  const items = GNSS_SYSTEM_ORDER
    .map((key) => {
      const count = breakdown[key];
      if (!count || count <= 0) return null;
      const info = GNSS_SYSTEMS[key];
      return { key, count, short: info.short, nameJa: info.nameJa };
    })
    .filter((item): item is { key: typeof GNSS_SYSTEM_ORDER[number]; count: number; short: string; nameJa: string } => Boolean(item));

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
        <span
          key={item.key}
          className={`sat-chip ${item.key}`}
          title={`${item.nameJa}: ${item.count}機`}
        >
          <span className="sat-chip-name">{item.short}</span>
          <span className="sat-chip-count">{item.count}</span>
        </span>
      ))}
    </div>
  );
}

function getInitialNtripConfig(): SavedNtripConfig {
  if (typeof window === 'undefined') return {};
  try {
    const saved = localStorage.getItem('ntrip_config');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export default function MonitorClient() {
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [baudRate, setBaudRate] = useState(38400);
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [maxLogs, setMaxLogs] = useState<number>(DEFAULT_MAX_LOGS);
  const [paused, setPaused] = useState(false);
  const [isNewestFirst, setIsNewestFirst] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [error, setError] = useState('');
  const [portInfo, setPortInfo] = useState<SerialPortInfo>({});
  const [lineCount, setLineCount] = useState(0);
  const [byteCount, setByteCount] = useState(0);
  const [clock, setClock] = useState(0);

  // ログ表示設定＆モーダル状態
  const [logDisplayMode, setLogDisplayMode] = useState<'explained' | 'summary' | 'raw'>('explained');
  const [logCategoryFilter, setLogCategoryFilter] = useState<'all' | MessageCategory>('all');
  const [selectedLogForModal, setSelectedLogForModal] = useState<LogLine | null>(null);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [dictSearchQuery, setDictSearchQuery] = useState('');
  const [dictCategoryTab, setDictCategoryTab] = useState<'all' | MessageCategory>('all');
  const [copiedLogText, setCopiedLogText] = useState(false);

  // 補正モード状態
  const [mode, setMode] = useState<CorrectionMode>('clas');

  // NTRIP 関連状態（初期値を localStorage から取得）
  const [savedConfig] = useState<SavedNtripConfig>(getInitialNtripConfig);
  const [ntripStatus, setNtripStatus] = useState<NtripStatus>('idle');
  const [ntripHost, setNtripHost] = useState(savedConfig.host || 'rtk2go.com');
  const [ntripPort, setNtripPort] = useState(savedConfig.port || 2101);
  const [ntripMountpoint, setNtripMountpoint] = useState(savedConfig.mountpoint || '');
  const [ntripUsername, setNtripUsername] = useState(savedConfig.username || '');
  const [ntripPassword, setNtripPassword] = useState(savedConfig.password || 'none');
  const [autoSelectMountpoint, setAutoSelectMountpoint] = useState(savedConfig.autoSelect ?? true);
  const [sourceTable, setSourceTable] = useState<MountpointRecord[]>([]);
  const [isFetchingSources, setIsFetchingSources] = useState(false);
  const [ntripBytesReceived, setNtripBytesReceived] = useState(0);
  const [ntripRateKbps, setNtripRateKbps] = useState(0);
  const [lastRtcmAt, setLastRtcmAt] = useState<number | null>(null);
  const [lastL6At, setLastL6At] = useState<number | null>(null);
  const [l6Summary, setL6Summary] = useState<string>('');
  const [ntripError, setNtripError] = useState('');
  const [isManualMountpoint, setIsManualMountpoint] = useState(false);

  const isSupported = useSyncExternalStore(
    () => () => {},
    () => typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { serial?: SerialApi }).serial),
    () => false,
  );

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readTaskRef = useRef<Promise<void> | null>(null);
  const originalPvtRateRef = useRef<number | null>(null);
  const temporaryOutputEnabledRef = useRef(false);
  const valgetReplyReceivedRef = useRef(false);
  const valgetAckReceivedRef = useRef(false);
  const pvtEnableRequestedRef = useRef(false);
  const keepReadingRef = useRef(false);
  const pausedRef = useRef(false);
  const maxLogsRef = useRef(DEFAULT_MAX_LOGS);
  const logIdRef = useRef(0);
  const satellitesInViewByTalkerRef = useRef<Record<string, number>>({});
  const satellitesInViewByPrnRef = useRef<Record<string, { talker: string; prn: number; updatedAt: number }>>({});
  const satellitesUsedGsaRef = useRef<Record<string, { talker: string; systemId?: number; prns: number[]; updatedAt: number }>>({});
  const terminalRef = useRef<HTMLDivElement>(null);
  const isAutoScrollingRef = useRef(false);

  const ntripAbortControllerRef = useRef<AbortController | null>(null);
  const lastBytesRef = useRef(0);
  const saveNtripConfig = useCallback((updates: Partial<{ host: string; port: number; mountpoint: string; username: string; password: string; autoSelect: boolean }>) => {
    try {
      const current = {
        host: updates.host ?? ntripHost,
        port: updates.port ?? ntripPort,
        mountpoint: updates.mountpoint ?? ntripMountpoint,
        username: updates.username ?? ntripUsername,
        password: updates.password ?? ntripPassword,
        autoSelect: updates.autoSelect ?? autoSelectMountpoint,
      };
      localStorage.setItem('ntrip_config', JSON.stringify(current));
    } catch {
      // Ignore
    }
  }, [ntripHost, ntripPort, ntripMountpoint, ntripUsername, ntripPassword, autoSelectMountpoint]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { maxLogsRef.current = maxLogs; }, [maxLogs]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // NTRIP受信レート（KB/s）の定期計算
  useEffect(() => {
    if (ntripStatus !== 'connected') {
      return;
    }
    const timer = window.setInterval(() => {
      const deltaBytes = ntripBytesReceived - lastBytesRef.current;
      lastBytesRef.current = ntripBytesReceived;
      setNtripRateKbps(Math.max(0, Number((deltaBytes / 1024).toFixed(1))));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ntripStatus, ntripBytesReceived]);


  // 基準局候補の距離計算 & ソート（TakionCM001のGNSS測位位置を絶対基準とする）
  const takionHasPosition = telemetry.latitude !== undefined && telemetry.longitude !== undefined;
  const currentRefLat = telemetry.latitude ?? null;
  const currentRefLon = telemetry.longitude ?? null;

  const nearestMountpoints: MountpointCandidate[] = useMemo(() => {
    if (sourceTable.length === 0) return [];
    const withDistance = sourceTable.map((rec) => {
      let distanceKm: number | null = null;
      if (currentRefLat !== null && currentRefLon !== null && rec.latitude !== null && rec.longitude !== null) {
        distanceKm = calculateDistanceKm(currentRefLat, currentRefLon, rec.latitude, rec.longitude);
      }
      return { ...rec, distanceKm };
    });

    if (currentRefLat !== null && currentRefLon !== null) {
      return withDistance.sort((a, b) => {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }

    // Takionがまだ測位していない場合は国コードJPN優先でアルファベット順
    return withDistance.sort((a, b) => {
      if (a.country === 'JPN' && b.country !== 'JPN') return -1;
      if (a.country !== 'JPN' && b.country === 'JPN') return 1;
      return a.mountpoint.localeCompare(b.mountpoint);
    });
  }, [sourceTable, currentRefLat, currentRefLon]);

  // 選択中のマウントポイント（自動選択時は最寄り局を自動反映）
  const activeMountpoint = useMemo(() => {
    if (autoSelectMountpoint && !isManualMountpoint && nearestMountpoints.length > 0) {
      return nearestMountpoints[0]?.mountpoint || ntripMountpoint;
    }
    return ntripMountpoint;
  }, [autoSelectMountpoint, isManualMountpoint, nearestMountpoints, ntripMountpoint]);

  // Source-table 取得
  const fetchSourceTable = useCallback(async (host = ntripHost, port = ntripPort) => {
    setIsFetchingSources(true);
    setNtripError('');
    try {
      const res = await fetch(`/api/ntrip/sourcetable?host=${encodeURIComponent(host)}&port=${port}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '配信局一覧の取得に失敗しました。');
      }
      const records: MountpointRecord[] = data.records || [];
      setSourceTable(records);
      if (records.length > 0 && !ntripMountpoint) {
        setNtripMountpoint(records[0].mountpoint);
      }
    } catch (err) {
      setNtripError(err instanceof Error ? err.message : 'Source-tableの取得に失敗しました。');
    } finally {
      setIsFetchingSources(false);
    }
  }, [ntripHost, ntripPort, ntripMountpoint]);

  const consumeLines = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    const receivedAt = Date.now();
    const combinedUpdate: Partial<Telemetry> = { lastReceivedAt: receivedAt };
    const entries: LogLine[] = [];
    for (const text of lines) {
      const clean = text.trim();
      if (!clean) continue;
      const parsed = parseNmea(clean);

      // 可視衛星の集計 (GSV)
      if (parsed.gsvTalker && (parsed.gsvPrns !== undefined || parsed.gsvCount !== undefined)) {
        if (parsed.gsvPrns && parsed.gsvPrns.length > 0) {
          for (const prn of parsed.gsvPrns) {
            const sys = identifyGnssSystem(prn, parsed.gsvTalker);
            const prnKey = `${sys}_${prn}`;
            satellitesInViewByPrnRef.current[prnKey] = {
              talker: parsed.gsvTalker,
              prn,
              updatedAt: receivedAt,
            };
          }
        } else if (parsed.gsvCount !== undefined) {
          satellitesInViewByTalkerRef.current[parsed.gsvTalker] = parsed.gsvCount;
        }

        // 8秒以上更新のない可視衛星を削除
        for (const [key, entry] of Object.entries(satellitesInViewByPrnRef.current)) {
          if (receivedAt - entry.updatedAt > 8000) {
            delete satellitesInViewByPrnRef.current[key];
          }
        }

        const inViewBreakdown: SatelliteBreakdown = {};
        let totalInView = 0;

        if (Object.keys(satellitesInViewByPrnRef.current).length > 0) {
          for (const entry of Object.values(satellitesInViewByPrnRef.current)) {
            const sys = identifyGnssSystem(entry.prn, entry.talker);
            inViewBreakdown[sys] = (inViewBreakdown[sys] ?? 0) + 1;
            totalInView += 1;
          }
        } else {
          for (const [talker, count] of Object.entries(satellitesInViewByTalkerRef.current)) {
            if (count > 0) {
              const sys = getGnssSystemFromTalker(talker);
              inViewBreakdown[sys] = (inViewBreakdown[sys] ?? 0) + count;
              totalInView += count;
            }
          }
        }

        combinedUpdate.satellitesInViewBreakdown = inViewBreakdown;
        combinedUpdate.satellitesInView = totalInView;
      }

      // 使用衛星の集計 (GSA)
      if (parsed.gsaPrns !== undefined && parsed.gsaTalker) {
        const gsaKey = `${parsed.gsaTalker}_${parsed.gsaSystemId ?? 'default'}`;
        satellitesUsedGsaRef.current[gsaKey] = {
          talker: parsed.gsaTalker,
          systemId: parsed.gsaSystemId,
          prns: parsed.gsaPrns,
          updatedAt: receivedAt,
        };

        const usedBreakdown: SatelliteBreakdown = {};
        let totalUsed = 0;
        const allActivePrnKeys = new Set<string>();

        for (const [key, entry] of Object.entries(satellitesUsedGsaRef.current)) {
          if (receivedAt - entry.updatedAt > 5000) {
            delete satellitesUsedGsaRef.current[key];
            continue;
          }
          for (const prn of entry.prns) {
            const sys = identifyGnssSystem(prn, entry.talker, entry.systemId);
            const prnKey = `${sys}_${prn}`;
            if (!allActivePrnKeys.has(prnKey)) {
              allActivePrnKeys.add(prnKey);
              usedBreakdown[sys] = (usedBreakdown[sys] ?? 0) + 1;
              totalUsed += 1;
            }
          }
        }
        combinedUpdate.satellitesUsedBreakdown = usedBreakdown;
        if (combinedUpdate.satellitesUsed === undefined && totalUsed > 0) {
          combinedUpdate.satellitesUsed = totalUsed;
        }
      }

      Object.assign(combinedUpdate, parsed.update);

      const def = getMessageDefinition(parsed.type);
      const summaryFromRaw = formatNmeaSummary(parsed.type, clean);
      entries.push({
        id: logIdRef.current++,
        receivedAt,
        text: clean,
        rawText: clean,
        type: parsed.type,
        valid: parsed.valid,
        titleJa: def.titleJa,
        category: def.category,
        categoryJa: def.categoryJa,
        meaning: summaryFromRaw || def.summary,
      });
    }
    if (entries.length === 0) return;
    setTelemetry((current) => ({ ...current, ...combinedUpdate }));
    setLineCount((current) => current + entries.length);
    if (!pausedRef.current) setLogs((current) => [...current, ...entries].slice(-maxLogsRef.current));
  }, []);

  const enablePvtOutputIfReady = useCallback(() => {
    if (
      originalPvtRateRef.current !== 0
      || !valgetReplyReceivedRef.current
      || !valgetAckReceivedRef.current
      || pvtEnableRequestedRef.current
      || !writerRef.current
    ) return;

    pvtEnableRequestedRef.current = true;
    temporaryOutputEnabledRef.current = true;
    void writerRef.current.write(ENABLE_NAV_PVT_USB_RAM).catch((configError) => {
      pvtEnableRequestedRef.current = false;
      temporaryOutputEnabledRef.current = false;
      setError(configError instanceof Error ? configError.message : '測位データ出力を開始できませんでした。');
    });
  }, []);

  const consumeUbxFrame = useCallback((frame: Uint8Array) => {
    const receivedAt = Date.now();
    const parsed = parseUbx(frame);
    const payloadLength = frame[4] | (frame[5] << 8);

    if (frame[2] === 0x06 && frame[3] === 0x8b && payloadLength >= 9 && originalPvtRateRef.current === null) {
      const config = new DataView(frame.buffer, frame.byteOffset + 6, payloadLength);
      const key = config.getUint32(4, true);
      if (key === 0x20910009) {
        originalPvtRateRef.current = config.getUint8(8);
        valgetReplyReceivedRef.current = true;
        enablePvtOutputIfReady();
      }
    }

    if (frame[2] === 0x05 && payloadLength >= 2 && frame[6] === 0x06 && frame[7] === 0x8b) {
      if (frame[3] === 0x01) {
        valgetAckReceivedRef.current = true;
        enablePvtOutputIfReady();
      } else {
        setError('受信機が測位データ出力設定の照会を拒否しました。接続先のUSBポートを確認してください。');
      }
    }

    if (frame[2] === 0x05 && frame[3] === 0x00 && payloadLength >= 2 && frame[6] === 0x06 && frame[7] === 0x8a) {
      temporaryOutputEnabledRef.current = false;
      setError('受信機が測位データ出力の開始設定を拒否しました。');
    }

    if (parsed.type === 'QZSSL6') {
      setLastL6At(receivedAt);
      if (parsed.summary) setL6Summary(parsed.summary);
    }

    setTelemetry((current) => ({ ...current, ...parsed.update, lastReceivedAt: receivedAt }));
    setLineCount((current) => current + 1);
    if (!pausedRef.current) {
      const def = getMessageDefinition(parsed.type);
      const rawSummary = parsed.summary ?? `UBX-${parsed.type} · ${frame.length - 8} byte payload`;
      const entry: LogLine = {
        id: logIdRef.current++,
        receivedAt,
        text: rawSummary,
        rawText: rawSummary,
        type: parsed.type,
        valid: parsed.valid,
        titleJa: def.titleJa,
        category: def.category,
        categoryJa: def.categoryJa,
        meaning: parsed.summary || def.summary,
      };
      setLogs((current) => [...current, entry].slice(-maxLogsRef.current));
    }
  }, [enablePvtOutputIfReady]);

  const consumeRtcmFrame = useCallback((frame: Uint8Array) => {
    const receivedAt = Date.now();
    const parsed = parseRtcm(frame);
    setLastRtcmAt(receivedAt);
    setTelemetry((current) => ({ ...current, lastReceivedAt: receivedAt }));
    setLineCount((current) => current + 1);
    if (!pausedRef.current) {
      const def = getMessageDefinition(parsed.type);
      const rawSummary = parsed.summary ?? 'RTCM3 frame';
      const entry: LogLine = {
        id: logIdRef.current++,
        receivedAt,
        text: rawSummary,
        rawText: rawSummary,
        type: parsed.type,
        valid: parsed.valid,
        titleJa: def.titleJa,
        category: def.category,
        categoryJa: def.categoryJa,
        meaning: parsed.summary || def.summary,
      };
      setLogs((current) => [...current, entry].slice(-maxLogsRef.current));
    }
  }, []);

  const readFromPort = useCallback(async (port: SerialPortLike) => {
    if (!port.readable) throw new Error('受信ストリームを開けませんでした。');
    const reader = port.readable.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder('ascii');
    let pending = new Uint8Array(0);
    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        setByteCount((current) => current + value.byteLength);
        const appended = new Uint8Array(pending.length + value.length);
        appended.set(pending);
        appended.set(value, pending.length);
        pending = appended;

        let cursor = 0;
        while (cursor < pending.length) {
          if (pending[cursor] === 0xb5) {
            if (pending.length - cursor < 2) break;
            if (pending[cursor + 1] !== 0x62) {
              cursor += 1;
              continue;
            }
            if (pending.length - cursor < 6) break;
            const payloadLength = pending[cursor + 4] | (pending[cursor + 5] << 8);
            if (payloadLength > MAX_UBX_PAYLOAD_BYTES) {
              cursor += 1;
              continue;
            }
            const frameLength = payloadLength + 8;
            if (pending.length - cursor < frameLength) break;
            const frame = pending.slice(cursor, cursor + frameLength);
            if (parseUbx(frame).valid !== true) {
              cursor += 1;
              continue;
            }
            consumeUbxFrame(frame);
            cursor += frameLength;
            continue;
          }

          if (pending[cursor] === 0x24) {
            let lineEnd = cursor + 1;
            const searchEnd = Math.min(pending.length, cursor + MAX_NMEA_BYTES + 1);
            while (lineEnd < searchEnd && pending[lineEnd] !== 0x0a && pending[lineEnd] !== 0x0d) lineEnd += 1;
            if (lineEnd >= searchEnd) {
              if (pending.length - cursor <= MAX_NMEA_BYTES) break;
              cursor += 1;
              continue;
            }
            const sentence = isNmeaSentence(pending.slice(cursor, lineEnd), decoder);
            if (!sentence) {
              cursor += 1;
              continue;
            }
            consumeLines([sentence]);
            while (lineEnd < pending.length && (pending[lineEnd] === 0x0a || pending[lineEnd] === 0x0d)) lineEnd += 1;
            cursor = lineEnd;
            continue;
          }

          if (pending[cursor] === 0xd3) {
            if (pending.length - cursor < 3) break;
            if ((pending[cursor + 1] & 0xfc) !== 0) {
              cursor += 1;
              continue;
            }
            const payloadLength = ((pending[cursor + 1] & 0x03) << 8) | pending[cursor + 2];
            const frameLength = payloadLength + 6;
            if (pending.length - cursor < frameLength) break;
            const frame = pending.slice(cursor, cursor + frameLength);
            if (parseRtcm(frame).valid !== true) {
              cursor += 1;
              continue;
            }
            consumeRtcmFrame(frame);
            cursor += frameLength;
            continue;
          }

          cursor += 1;
        }

        pending = pending.slice(cursor);
        if (pending.length > MAX_UBX_PAYLOAD_BYTES + 8) pending = pending.slice(-16);
      }
    } catch (readError) {
      if (keepReadingRef.current) setError(readError instanceof Error ? readError.message : '受信中に接続が切れました。');
    } finally {
      reader.releaseLock();
      if (readerRef.current === reader) readerRef.current = null;
    }
  }, [consumeLines, consumeRtcmFrame, consumeUbxFrame]);

  // NTRIP 切断
  const stopNtripStream = useCallback(() => {
    if (ntripAbortControllerRef.current) {
      ntripAbortControllerRef.current.abort();
      ntripAbortControllerRef.current = null;
    }
    setNtripStatus('idle');
    setNtripRateKbps(0);
  }, []);

  // NTRIP 接続開始
  const startNtripStream = useCallback(async () => {
    const targetMountpoint = activeMountpoint;
    if (!targetMountpoint) {
      setNtripError('マウントポイントを指定してください。');
      return;
    }
    if (!writerRef.current) {
      setNtripError('TakionCM001受信機に接続してください（Web Serial未接続）。');
      return;
    }

    stopNtripStream();
    setNtripError('');
    setNtripStatus('connecting');
    setNtripBytesReceived(0);
    lastBytesRef.current = 0;

    saveNtripConfig({ host: ntripHost, port: ntripPort, mountpoint: targetMountpoint, username: ntripUsername, password: ntripPassword, autoSelect: autoSelectMountpoint });

    const controller = new AbortController();
    ntripAbortControllerRef.current = controller;

    try {
      const url = `/api/ntrip/stream?host=${encodeURIComponent(ntripHost)}&port=${ntripPort}&mountpoint=${encodeURIComponent(targetMountpoint)}&username=${encodeURIComponent(ntripUsername)}&password=${encodeURIComponent(ntripPassword)}`;
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(errorJson?.error || `NTRIPストリーム接続エラー (HTTP ${res.status})`);
      }

      if (!res.body) throw new Error('レスポンスボディが空です。');

      setNtripStatus('connected');
      const reader = res.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          setNtripBytesReceived((current) => current + value.byteLength);
          setLastRtcmAt(Date.now());
          // Web Serial への書き込み
          if (writerRef.current) {
            await writerRef.current.write(value).catch((writeErr) => {
              console.error('シリアル書き込みエラー:', writeErr);
            });
          }
        }
      }

      setNtripStatus('idle');
      setNtripRateKbps(0);
    } catch (err) {
      if (controller.signal.aborted) {
        setNtripStatus('idle');
        setNtripRateKbps(0);
      } else {
        setNtripStatus('error');
        setNtripRateKbps(0);
        setNtripError(err instanceof Error ? err.message : 'NTRIP接続が切断されました。');
      }
    } finally {
      if (ntripAbortControllerRef.current === controller) {
        ntripAbortControllerRef.current = null;
      }
    }
  }, [activeMountpoint, ntripHost, ntripPort, ntripUsername, ntripPassword, autoSelectMountpoint, stopNtripStream, saveNtripConfig]);

  const disconnect = useCallback(async (unexpected = false) => {
    stopNtripStream();
    if (!portRef.current) return;
    setConnection('disconnecting');
    keepReadingRef.current = false;
    try {
      if (temporaryOutputEnabledRef.current && writerRef.current) await writerRef.current.write(DISABLE_NAV_PVT_USB_RAM);
      await readerRef.current?.cancel();
      await readTaskRef.current;
      writerRef.current?.releaseLock();
      writerRef.current = null;
      await portRef.current.close();
    } catch (closeError) {
      if (!unexpected) setError(closeError instanceof Error ? closeError.message : '切断できませんでした。');
    } finally {
      portRef.current = null;
      readTaskRef.current = null;
      originalPvtRateRef.current = null;
      temporaryOutputEnabledRef.current = false;
      valgetReplyReceivedRef.current = false;
      valgetAckReceivedRef.current = false;
      pvtEnableRequestedRef.current = false;
      satellitesInViewByTalkerRef.current = {};
      satellitesInViewByPrnRef.current = {};
      satellitesUsedGsaRef.current = {};
      setConnection('idle');
    }
  }, [stopNtripStream]);

  useEffect(() => () => {
    keepReadingRef.current = false;
    void readerRef.current?.cancel();
    stopNtripStream();
  }, [stopNtripStream]);

  const connect = async () => {
    const serial = (navigator as Navigator & { serial?: SerialApi }).serial;
    if (!serial) {
      setError('Web Serial APIを利用できません。最新版のChromeで、localhostまたはHTTPSから開いてください。');
      return;
    }
    setError('');
    setConnection('connecting');
    setTelemetry({});
    setLogs([]);
    setLineCount(0);
    setByteCount(0);
    satellitesInViewByTalkerRef.current = {};
    satellitesInViewByPrnRef.current = {};
    satellitesUsedGsaRef.current = {};
    originalPvtRateRef.current = null;
    temporaryOutputEnabledRef.current = false;
    valgetReplyReceivedRef.current = false;
    valgetAckReceivedRef.current = false;
    pvtEnableRequestedRef.current = false;
    try {
      const port = await serial.requestPort({ filters: [{ usbVendorId: UBLOX_VENDOR_ID }] });
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 65536 });
      portRef.current = port;
      if (!port.writable) throw new Error('受信機への照会ストリームを開けませんでした。');
      writerRef.current = port.writable.getWriter();
      setPortInfo(port.getInfo());
      setConnection('connected');
      keepReadingRef.current = true;
      const task = readFromPort(port).finally(() => { if (keepReadingRef.current) void disconnect(true); });
      readTaskRef.current = task;
      await writerRef.current.write(GET_NAV_PVT_USB_RATE);
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : '';
      if (!message.toLowerCase().includes('no port selected')) setError(message || '受信機に接続できませんでした。');
      writerRef.current?.releaseLock();
      writerRef.current = null;
      if (portRef.current) await portRef.current.close().catch(() => undefined);
      portRef.current = null;
      setConnection('idle');
    }
  };

  // 実際に現在有効な補正ソース（Active Source）のリアルタイム判定
  const isNtripActive = ntripStatus === 'connected' && lastRtcmAt !== null && (clock - lastRtcmAt < 10000);
  const isL6Active = lastL6At !== null && (clock - lastL6At < 12000);

  const activeSource = useMemo(() => {
    const q = telemetry.quality ?? 0;

    // 0. 単独測位モード（補正なし）が明示的に選択されている場合
    if (mode === 'none') {
      if (q === 4) {
        return {
          type: 'none',
          statusTone: 'fix',
          badgeLabel: '⚪ 単独測位 (内部CLAS Fix)',
          badgeShort: '⚪ 単独測位',
          detail: '単独測位 (内部CLAS Fix)',
          suffix: '',
          isConverging: false,
        };
      }
      if (q === 5) {
        return {
          type: 'none',
          statusTone: 'float',
          badgeLabel: '⚪ 単独測位 (内部CLAS Float)',
          badgeShort: '⚪ 単独測位',
          detail: '単独測位 (内部CLAS Float)',
          suffix: '',
          isConverging: false,
        };
      }
      return {
        type: 'none',
        statusTone: 'single',
        badgeLabel: '⚪ 単独測位 (補正なし)',
        badgeShort: '⚪ 単独測位',
        detail: 'GNSS 単独測位',
        suffix: '',
        isConverging: false,
      };
    }

    // 1. 高精度 Fix (quality === 4)
    if (q === 4) {
      if (isNtripActive) {
        return {
          type: 'ntrip',
          statusTone: 'fix',
          badgeLabel: `🌐 ネットワークRTK Fix (${activeMountpoint || 'RTK2GO'})`,
          badgeShort: `🌐 RTK Fix`,
          detail: `RTK Fix完了 (${activeMountpoint || 'RTK2GO'})`,
          suffix: ' (RTK)',
          isConverging: false,
        };
      }
      return {
        type: 'clas',
        statusTone: 'fix',
        badgeLabel: '🛰️ CLAS Fix (みちびき L6)',
        badgeShort: '🛰️ CLAS Fix',
        detail: 'みちびきL6 補正完了',
        suffix: ' (CLAS)',
        isConverging: false,
      };
    }

    // 2. 高精度 Float (quality === 5)
    if (q === 5) {
      if (isNtripActive) {
        return {
          type: 'ntrip',
          statusTone: 'float',
          badgeLabel: `🌐 ネットワークRTK Float (${activeMountpoint || 'RTK2GO'})`,
          badgeShort: `🌐 RTK Float`,
          detail: 'RTK 収束中 (Float)',
          suffix: ' (RTK)',
          isConverging: true,
        };
      }
      return {
        type: 'clas-converging',
        statusTone: 'float',
        badgeLabel: '🛰️ CLAS Float (収束中)',
        badgeShort: '🛰️ CLAS Float',
        detail: 'みちびきL6 収束中 (Float)',
        suffix: ' (CLAS)',
        isConverging: true,
      };
    }

    // 3. 単独測位 (quality === 1)
    if (q === 1) {
      if (mode === 'clas') {
        return {
          type: 'clas-converging',
          statusTone: 'single',
          badgeLabel: isL6Active 
            ? '🛰️ CLAS 収束待機中 (3D FIX)' 
            : '🛰️ CLAS 探索中 (3D FIX)',
          badgeShort: isL6Active ? '🛰️ CLAS 収束中' : '🛰️ CLAS 探索中',
          detail: isL6Active 
            ? 'みちびきL6 受信中 (収束待機)' 
            : 'みちびきL6 探索中',
          suffix: ' (CLAS待機)',
          isConverging: true,
        };
      }
      if (mode === 'ntrip') {
        return {
          type: isNtripActive ? 'ntrip-converging' : 'none',
          statusTone: 'single',
          badgeLabel: isNtripActive 
            ? `🌐 ネットワークRTK 待機中 (${activeMountpoint || 'RTK2GO'})` 
            : '🌐 ネットワークRTK 未接続',
          badgeShort: isNtripActive ? '🌐 RTK 待機中' : '🌐 RTK 未接続',
          detail: isNtripActive 
            ? 'RTCMデータ受信中 (RTK待機)' 
            : 'NTRIP未接続 (単独測位)',
          suffix: isNtripActive ? ' (RTK待機)' : '',
          isConverging: isNtripActive,
        };
      }
      return {
        type: 'none',
        statusTone: 'single',
        badgeLabel: '⚪ 単独測位 (補正なし)',
        badgeShort: '⚪ 単独測位',
        detail: 'GNSS 単独測位',
        suffix: '',
        isConverging: false,
      };
    }

    // 4. 未測位
    return {
      type: 'none',
      statusTone: 'none',
      badgeLabel: '⚪ 未測位',
      badgeShort: '未測位',
      detail: '測位データ待ち',
      suffix: '',
      isConverging: false,
    };
  }, [telemetry.quality, isNtripActive, isL6Active, mode, activeMountpoint]);

  // 測位品質バッジの表示調整
  const quality = useMemo(() => {
    const base = qualityLabels[telemetry.quality ?? 0] ?? { label: `測位品質 ${telemetry.quality}`, short: `Q${telemetry.quality}`, tone: 'single' };
    if (telemetry.quality === 4) {
      return { ...base, label: `高精度測位 Fix${activeSource.suffix}`, short: 'FIX', badgeText: 'FIX' };
    }
    if (telemetry.quality === 5) {
      return { ...base, label: `高精度測位 Float${activeSource.suffix}`, short: 'FLOAT', badgeText: 'FLOAT' };
    }
    if (telemetry.quality === 1) {
      return { ...base, label: '単独測位 (3D FIX)', short: '3D FIX', badgeText: '3D FIX' };
    }
    return { ...base, badgeText: base.short };
  }, [telemetry.quality, activeSource]);

  const hasPosition = telemetry.latitude !== undefined && telemetry.longitude !== undefined;
  const lastAge = telemetry.lastReceivedAt === undefined ? 'データ待ち' : `${Math.max(0, Math.floor((clock - telemetry.lastReceivedAt) / 1000))}秒前`;
  const latestTypes = useMemo(() => {
    const counts = new Map<string, number>();
    logs.forEach((line) => counts.set(line.type, (counts.get(line.type) ?? 0) + 1));
    return [...counts.entries()].slice(0, 5);
  }, [logs]);

  const displayedLogs = useMemo(() => {
    let filtered = logs;
    if (logCategoryFilter !== 'all') {
      filtered = filtered.filter((line) => line.category === logCategoryFilter);
    }
    return isNewestFirst ? [...filtered].reverse() : filtered;
  }, [logs, isNewestFirst, logCategoryFilter]);

  // ユーザーの手動スクロールによる追従停止・再開の判定
  const handleTerminalScroll = useCallback(() => {
    if (isAutoScrollingRef.current || !terminalRef.current) return;
    const el = terminalRef.current;

    if (!isNewestFirst) {
      // 古い順：最下部付近（32px以内）にいる場合は自動追従を有効化、上方向に離れたら停止
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
      setIsAutoScroll(isAtBottom);
    } else {
      // 新しい順：最上部付近（32px以内）にいる場合は自動追従を有効化、下方向に離れたら停止
      const isAtTop = el.scrollTop <= 32;
      setIsAutoScroll(isAtTop);
    }
  }, [isNewestFirst]);

  // 最新位置（古い順なら最下部、新しい順なら最上部）へ移動し自動追従を再開
  const scrollToLatest = useCallback(() => {
    if (!terminalRef.current) return;
    const el = terminalRef.current;
    isAutoScrollingRef.current = true;
    setIsAutoScroll(true);
    if (!isNewestFirst) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = 0;
    }
    requestAnimationFrame(() => {
      if (terminalRef.current) {
        if (!isNewestFirst) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        } else {
          terminalRef.current.scrollTop = 0;
        }
      }
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    });
  }, [isNewestFirst]);

  // 自動追従が有効な時、新しいログが来たら最新位置へスクロール
  useEffect(() => {
    if (!paused && isAutoScroll && terminalRef.current) {
      const el = terminalRef.current;
      isAutoScrollingRef.current = true;
      if (!isNewestFirst) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = 0;
      }
      const rafId = requestAnimationFrame(() => {
        if (terminalRef.current) {
          if (!isNewestFirst) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
          } else {
            terminalRef.current.scrollTop = 0;
          }
        }
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = false;
        });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [displayedLogs, logDisplayMode, isNewestFirst, paused, isAutoScroll]);

  // 全電文定義（リファレンスモーダル用）
  const allDictDefinitions = useMemo(() => getAllMessageDefinitions(), []);
  const filteredDictDefinitions = useMemo(() => {
    return allDictDefinitions.filter((item) => {
      if (dictCategoryTab !== 'all' && item.category !== dictCategoryTab) return false;
      if (dictSearchQuery) {
        const q = dictSearchQuery.toLowerCase();
        return (
          item.type.toLowerCase().includes(q) ||
          item.titleJa.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allDictDefinitions, dictCategoryTab, dictSearchQuery]);

  // 選択中ログの詳細定義取得
  const selectedLogDefinition = useMemo(() => {
    if (!selectedLogForModal) return null;
    return getMessageDefinition(selectedLogForModal.type);
  }, [selectedLogForModal]);

  const handleCopyRawText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedLogText(true);
    setTimeout(() => setCopiedLogText(false), 2000);
  }, []);

  // モード切り替えハンドラー
  const handleModeChange = (nextMode: CorrectionMode) => {
    if (mode === nextMode) return;
    if (mode === 'ntrip' && nextMode !== 'ntrip') {
      stopNtripStream();
    }
    setMode(nextMode);
    if (nextMode === 'ntrip' && sourceTable.length === 0 && !isFetchingSources) {
      void fetchSourceTable();
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div><p className="eyebrow">GNSS / CLAS & NETWORK RTK</p><h1>Takion CLAS / RTK Monitor</h1></div>
        </div>
        <div className="header-status">
          <div className={`connection-chip ${connection}`}><span className="status-dot" />{connection === 'connected' ? '受信機 接続中' : connection === 'connecting' ? '受信機 接続中…' : '受信機 未接続'}</div>
        </div>
      </header>

      <section className="device-toolbar panel" aria-label="受信機への接続">
        <div className="device-heading">
          <p className="card-label">USB SERIAL RECEIVER</p>
          <div className="device-name">
            <h2>TakionCM001</h2>
            <span className={`api-badge ${isSupported ? 'supported' : 'unsupported'}`}>{isSupported ? 'Web Serial' : '非対応'}</span>
          </div>
        </div>
        <div className="device-id"><span>VID / PID</span><code>{formatHex(portInfo.usbVendorId || UBLOX_VENDOR_ID)} / {formatHex(portInfo.usbProductId)}</code></div>
        <label className="baud-control">
          <span>Baud</span>
          <select value={baudRate} disabled={connection !== 'idle'} onChange={(event) => setBaudRate(Number(event.target.value))}>
            {[9600, 19200, 38400, 57600, 115200, 230400, 460800].map((rate) => <option value={rate} key={rate}>{rate.toLocaleString()} bps</option>)}
          </select>
        </label>
        {connection === 'connected' ? (
          <button className="connect-button disconnect-button" onClick={() => void disconnect()}>切断</button>
        ) : (
          <button className="connect-button" onClick={() => void connect()} disabled={!isSupported || connection !== 'idle'}>{connection === 'connecting' ? '接続中…' : '接続'}</button>
        )}
      </section>

      {/* 補正モード切り替えセグメントコントロール */}
      <section className="correction-mode-panel panel" aria-label="補正モード選択">
        <div className="mode-header">
          <span className="card-label">CORRECTION SOURCE</span>
          <span className="mode-active-indicator">
            選択中: <strong>{mode === 'clas' ? '🛰️ CLAS (みちびき L6衛星補正)' : mode === 'ntrip' ? `🌐 ネットワークRTK (${ntripStatus === 'connected' ? '接続中' : '未接続'})` : '⚪ 単独測位'}</strong>
          </span>
        </div>
        <div className="mode-toggle-group">
          <button
            type="button"
            className={`mode-tab ${mode === 'clas' ? 'active' : ''}`}
            onClick={() => handleModeChange('clas')}
          >
            <span className="mode-icon">🛰️</span>
            <div>
              <strong>CLAS (みちびき L6)</strong>
              <small>
                {isL6Active
                  ? `🛰️ L6信号受信中 ${l6Summary ? `(${l6Summary})` : ''}`
                  : '衛星信号から直接補正 (完全オフライン / 収束に数分)'}
              </small>
            </div>
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'ntrip' ? 'active' : ''}`}
            onClick={() => handleModeChange('ntrip')}
          >
            <span className="mode-icon">🌐</span>
            <div>
              <strong>ネットワークRTK (NTRIP)</strong>
              <small>
                {ntripStatus === 'connected'
                  ? `🌐 RTCM受信中 (${ntripRateKbps} KB/s · 即時Fix)`
                  : 'インターネット経由で即時Fix (RTK2GO等)'}
              </small>
            </div>
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'none' ? 'active' : ''}`}
            onClick={() => handleModeChange('none')}
          >
            <span className="mode-icon">⚪</span>
            <div>
              <strong>単独測位</strong>
              <small>補正なし (通常のGNSS 3D Fix)</small>
            </div>
          </button>
        </div>
      </section>

      {/* ネットワークRTK 設定・接続パネル (NTRIPモード選択時のみ展開) */}
      {mode === 'ntrip' && (
        <section className="ntrip-config-panel panel" aria-label="NTRIP接続設定">
          <div className="ntrip-panel-header">
            <div>
              <p className="card-label">NTRIP CLIENT CONFIGURATION</p>
              <h3>ネットワークRTK 接続設定</h3>
            </div>
            <div className="ntrip-status-badge">
              <span className={`ntrip-led ${ntripStatus}`} />
              <span>{ntripStatus === 'connected' ? `RTCM受信中 (${ntripRateKbps} KB/s)` : ntripStatus === 'connecting' ? '接続中…' : ntripStatus === 'error' ? 'エラー' : '未接続'}</span>
            </div>
          </div>

          <div className="ntrip-grid">
            <div className="ntrip-field">
              <label>Caster サーバー / ポート</label>
              <div className="input-group">
                <input
                  type="text"
                  value={ntripHost}
                  onChange={(e) => setNtripHost(e.target.value)}
                  placeholder="rtk2go.com"
                  disabled={ntripStatus === 'connected' || ntripStatus === 'connecting'}
                />
                <input
                  type="number"
                  style={{ width: '80px' }}
                  value={ntripPort}
                  onChange={(e) => setNtripPort(Number(e.target.value))}
                  placeholder="2101"
                  disabled={ntripStatus === 'connected' || ntripStatus === 'connecting'}
                />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void fetchSourceTable()}
                  disabled={isFetchingSources || ntripStatus === 'connected'}
                >
                  {isFetchingSources ? '取得中…' : '局リスト更新'}
                </button>
              </div>
            </div>

            <div className="ntrip-field">
              <label>
                基準局 (マウントポイント)
                {takionHasPosition ? (
                  <span className="coords-hint">（🛰️ Takion位置基準: {telemetry.latitude?.toFixed(4)}, {telemetry.longitude?.toFixed(4)} から自動検出）</span>
                ) : (
                  <span className="coords-hint waiting">（⚠️ Takion測位データ待ち · 受信機が測位すると自動選定）</span>
                )}
              </label>

              {!isManualMountpoint ? (
                <div className="mountpoint-select-wrapper">
                  <select
                    value={activeMountpoint}
                    onChange={(e) => {
                      setAutoSelectMountpoint(false);
                      setNtripMountpoint(e.target.value);
                    }}
                    disabled={ntripStatus === 'connected' || isFetchingSources}
                  >
                    {nearestMountpoints.length === 0 ? (
                      <option value={activeMountpoint || ''}>{activeMountpoint ? activeMountpoint : '局リストを取得してください'}</option>
                    ) : (
                      nearestMountpoints.map((rec) => (
                        <option key={rec.mountpoint} value={rec.mountpoint}>
                          {rec.mountpoint} {rec.distanceKm !== null ? `(${rec.distanceKm.toFixed(1)} km)` : ''} · {rec.country || 'GLOBAL'} ({rec.format})
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setIsManualMountpoint(true)}
                  >
                    手動入力
                  </button>
                </div>
              ) : (
                <div className="input-group">
                  <input
                    type="text"
                    value={ntripMountpoint}
                    onChange={(e) => setNtripMountpoint(e.target.value)}
                    placeholder="マウントポイント名 (例: SAKURA_BASE)"
                    disabled={ntripStatus === 'connected'}
                  />
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setIsManualMountpoint(false)}
                  >
                    リスト選択に戻す
                  </button>
                </div>
              )}
            </div>

            <div className="ntrip-field">
              <label>ユーザー名 (メールアドレス)</label>
              <input
                type="text"
                value={ntripUsername}
                onChange={(e) => setNtripUsername(e.target.value)}
                placeholder="user@example.com (RTK2GO接続時)"
                disabled={ntripStatus === 'connected'}
              />
            </div>

            <div className="ntrip-field">
              <label>パスワード (任意)</label>
              <input
                type="password"
                value={ntripPassword}
                onChange={(e) => setNtripPassword(e.target.value)}
                placeholder="none (RTK2GOは不要)"
                disabled={ntripStatus === 'connected'}
              />
            </div>

            <div className="ntrip-actions">
              {ntripStatus === 'connected' ? (
                <button type="button" className="connect-button disconnect-button" onClick={stopNtripStream}>
                  NTRIP 切断
                </button>
              ) : (
                <button
                  type="button"
                  className="connect-button"
                  onClick={() => void startNtripStream()}
                  disabled={connection !== 'connected' || ntripStatus === 'connecting'}
                >
                  {ntripStatus === 'connecting' ? '接続中…' : 'NTRIP 接続開始'}
                </button>
              )}
            </div>
          </div>

          {ntripError && (
            <div className="ntrip-error" role="alert">
              <span>⚠️ {ntripError}</span>
            </div>
          )}

          {ntripStatus === 'connected' && (
            <div className="ntrip-live-bar">
              <span className="live-pill">LIVE</span>
              <span>受信サイズ: <strong>{(ntripBytesReceived / 1024).toFixed(1)} KB</strong></span>
              <span>転送レート: <strong>{ntripRateKbps} KB/s</strong></span>
              <span>最終受信: <strong>{lastRtcmAt ? `${Math.max(0, Math.floor((clock - lastRtcmAt) / 1000))}秒前` : '—'}</strong></span>
            </div>
          )}
        </section>
      )}

      {error && <div className="error-banner" role="alert"><strong>接続エラー</strong><span>{error}</span><button onClick={() => setError('')}>閉じる</button></div>}

      <section className="dashboard" aria-label="測位情報">
        <article className="position-panel panel">
          <div className="panel-heading">
            <div className="panel-title-with-badge">
              <h3>現在位置</h3>
              <span className={`source-tag ${activeSource.type}`}>{activeSource.badgeShort}</span>
            </div>
            <span className={`fix-badge ${quality.tone}`}>{quality.badgeText}</span>
          </div>
          <div className={`coordinate-display ${hasPosition ? 'has-position' : ''}`}>
            <div className="coordinate-row"><span className="axis">LAT</span><strong>{telemetry.latitude === undefined ? '— — —' : Math.abs(telemetry.latitude).toFixed(9)}</strong><span className="direction">{telemetry.latitude === undefined ? '' : telemetry.latitude >= 0 ? 'N' : 'S'}</span></div>
            <div className="coordinate-row"><span className="axis">LON</span><strong>{telemetry.longitude === undefined ? '— — —' : Math.abs(telemetry.longitude).toFixed(9)}</strong><span className="direction">{telemetry.longitude === undefined ? '' : telemetry.longitude >= 0 ? 'E' : 'W'}</span></div>
          </div>
          <div className="position-meta">
            <div><span>標高</span><strong>{telemetry.altitude === undefined ? '—' : <>{telemetry.altitude.toFixed(3)} <small>m</small></>}</strong></div>
            <div><span>推定水平誤差</span><strong>{telemetry.horizontalError === undefined ? '—' : <>{telemetry.horizontalError.toFixed(3)} <small>m</small></>}</strong></div>
            <div><span>UTC</span><strong>{telemetry.timeUtc ? <>{telemetry.timeUtc} <small>UTC</small></> : '—'}</strong></div>
          </div>
        </article>

        <article className="fix-panel panel">
          <div className="panel-heading">
            <div className="panel-title-with-badge">
              <h3>測位ステータス</h3>
              <span className={`source-tag ${activeSource.type}`}>{activeSource.badgeShort}</span>
            </div>
            <span className={`signal-orbit ${connection === 'connected' ? 'active' : ''}`} aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="fix-state">
            <span className={`fix-indicator ${quality.tone}`} />
            <div>
              <strong>{quality.label}</strong>
              <span className="fix-source-detail">
                {connection === 'connected' ? `${activeSource.detail} · ${lastAge}` : '受信機を接続してください'}
              </span>
            </div>
          </div>
          <div className="satellites-section">
            {/* 使用衛星 */}
            <div className="sat-group">
              <div className="sat-group-header">
                <span className="sat-group-title">使用衛星</span>
                <span className="sat-group-total"><strong>{telemetry.satellitesUsed ?? '—'}</strong> <small>SV</small></span>
              </div>
              <SatelliteBreakdownBadges breakdown={telemetry.satellitesUsedBreakdown} />
            </div>

            {/* 可視衛星 */}
            <div className="sat-group">
              <div className="sat-group-header">
                <span className="sat-group-title">可視衛星</span>
                <span className="sat-group-total"><strong>{telemetry.satellitesInView ?? '—'}</strong> <small>SV</small></span>
              </div>
              <SatelliteBreakdownBadges breakdown={telemetry.satellitesInViewBreakdown} />
            </div>
          </div>

          <div className="dop-container">
            <div className="dop-header">
              <span className="dop-title">衛星配置・精度低下率 (DOP)</span>
              {telemetry.pdop !== undefined && (
                <span className={`dop-status-tag ${telemetry.pdop <= 1.2 ? 'great' : telemetry.pdop <= 2.5 ? 'good' : 'fair'}`}>
                  {telemetry.pdop <= 1.2 ? '● 極めて良好' : telemetry.pdop <= 2.5 ? '● 良好' : '● 普通'}
                </span>
              )}
            </div>
            <div className="dop-grid">
              <div className="dop-card">
                <div className="dop-card-label">HDOP <small>水平</small></div>
                <div className="dop-card-value">{formatValue(telemetry.hdop, 2)}</div>
              </div>
              <div className="dop-card primary">
                <div className="dop-card-label">PDOP <small>3D</small></div>
                <div className="dop-card-value">{formatValue(telemetry.pdop, 2)}</div>
              </div>
              <div className="dop-card">
                <div className="dop-card-label">VDOP <small>垂直</small></div>
                <div className="dop-card-value">{formatValue(telemetry.vdop, 2)}</div>
              </div>
            </div>
          </div>
        </article>

        <article className="motion-panel panel">
          <div className="panel-heading">
            <h3>移動情報</h3>
          </div>
          <div className="speed-value"><strong>{formatValue(telemetry.speedKmh, 1)}</strong><span>km/h</span></div>
          <div className="motion-meta-group">
            <div className="course-line"><span>進行方向</span><strong>{formatValue(telemetry.course, 1, '°')}</strong></div>
            <div className="course-rule"><span style={{ transform: `translateX(${Math.min(100, Math.max(0, (telemetry.course ?? 0) / 3.6))}%)` }} /></div>
            <div className="date-line"><span>測位日</span><strong>{telemetry.dateUtc ?? '—'}</strong></div>
          </div>
        </article>
      </section>

      <section className="map-panel panel" aria-label="現在地マップ">
        <div className="map-panel-heading">
          <div>
            <h3>現在地マップ</h3>
          </div>
          <div className="map-panel-status">
            <span className={`fix-indicator ${quality.tone}`} />
            <span>{hasPosition ? `${quality.short} · ${formatValue(telemetry.horizontalError, 2, ' m')} [${activeSource.badgeShort}]` : '測位データ待ち'}</span>
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

      <section className="log-panel panel" aria-label="受信ログ">
        <div className="log-heading">
          <div>
            <h3>受信ログ</h3>
          </div>
          <div className="log-actions">
            <select
              style={{ fontSize: '11px', lineHeight: '24px' }}
              value={logDisplayMode}
              onChange={(event) => setLogDisplayMode(event.target.value as 'explained' | 'summary' | 'raw')}
              aria-label="ログの表示形式"
            >
              <option value="explained">💡 解説付き</option>
              <option value="summary">📝 日本語要約</option>
              <option value="raw">💻 生ログのみ</option>
            </select>

            <select
              style={{ fontSize: '11px', lineHeight: '24px' }}
              value={logCategoryFilter}
              onChange={(event) => setLogCategoryFilter(event.target.value as 'all' | MessageCategory)}
              aria-label="ログの種別絞り込み"
            >
              <option value="all">全電文</option>
              <option value="position">📍 測位・位置</option>
              <option value="satellite">🛰️ 衛星・精度</option>
              <option value="clas">📡 CLAS補正</option>
              <option value="rtk">🌐 RTK補正</option>
              <option value="system">⚙️ システム/設定</option>
            </select>

            <select
              style={{ fontSize: '11px', lineHeight: '24px' }}
              value={maxLogs}
              onChange={(event) => {
                const nextMax = Number(event.target.value);
                setMaxLogs(nextMax);
                setLogs((current) => current.slice(-nextMax));
              }}
              aria-label="ログの保持件数"
            >
              {LOG_LIMIT_OPTIONS.map((limit) => (
                <option value={limit} key={limit}>
                  {limit}行
                </option>
              ))}
            </select>

            <select
              style={{ fontSize: '11px', lineHeight: '24px' }}
              value={isNewestFirst ? 'newest' : 'oldest'}
              onChange={(event) => {
                const nextIsNewestFirst = event.target.value === 'newest';
                setIsNewestFirst(nextIsNewestFirst);
                setIsAutoScroll(true);
                if (terminalRef.current) {
                  isAutoScrollingRef.current = true;
                  terminalRef.current.scrollTop = nextIsNewestFirst ? 0 : terminalRef.current.scrollHeight;
                  requestAnimationFrame(() => {
                    isAutoScrollingRef.current = false;
                  });
                }
              }}
              aria-label="ログの表示順"
            >
              <option value="oldest">古い順</option>
              <option value="newest">新しい順</option>
            </select>

            <button
              type="button"
              className="dict-btn"
              style={{ fontSize: '11px', lineHeight: '24px' }}
              onClick={() => setShowDictionaryModal(true)}
              title="受信電文（NMEA / UBX / RTCM）の意味一覧を開く"
            >
              📖 電文解説
            </button>

            <button
              type="button"
              style={{ fontSize: '11px', lineHeight: '24px' }}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? '再開' : '一時停止'}
            </button>

            <button
              type="button"
              style={{ fontSize: '11px', lineHeight: '24px' }}
              onClick={() => {
                setLogs([]);
                setIsAutoScroll(true);
              }}
            >
              クリア
            </button>
          </div>
        </div>

        <div className="log-summary">
          <div><span>受信フレーム</span><strong>{lineCount.toLocaleString()}</strong></div>
          <div><span>受信サイズ</span><strong>{(byteCount / 1024).toFixed(1)} KB</strong></div>
          <div className="sentence-chips">
            {latestTypes.length > 0 ? latestTypes.map(([type, count]) => (
              <span key={type}>{type} <b>{count}</b></span>
            )) : <span>データ待ち</span>}
          </div>
        </div>

        <div className="terminal-wrapper">
          <div
            ref={terminalRef}
            className="terminal"
            onScroll={handleTerminalScroll}
            aria-live="polite"
            aria-label="受信した測位データ"
          >
            {displayedLogs.length === 0 ? (
              <div className="terminal-empty">
                <span className="terminal-cursor" />
                <p>受信機に接続すると、受信した電文の意味とデータがリアルタイムに流れます。</p>
              </div>
            ) : (
              displayedLogs.map((line) => (
                <div
                  className="log-line"
                  key={line.id}
                  onClick={() => setSelectedLogForModal(line)}
                  title="クリックしてこの電文の詳しい解説を表示"
                >
                  {logDisplayMode === 'raw' && (
                    <div className="log-line-raw">
                      <time>{new Date(line.receivedAt).toLocaleTimeString('ja-JP', { hour12: false })}</time>
                      <span className="log-type">{line.type}</span>
                      <code>{line.rawText || line.text}</code>
                      <span className={`checksum ${line.valid === true ? 'ok' : line.valid === false ? 'bad' : ''}`}>
                        {line.valid === true ? 'OK' : line.valid === false ? 'ERR' : '—'}
                      </span>
                    </div>
                  )}

                  {logDisplayMode === 'explained' && (
                    <div className="log-line-explained">
                      <div className="log-line-header">
                        <time>{new Date(line.receivedAt).toLocaleTimeString('ja-JP', { hour12: false })}</time>
                        <span className={`cat-badge ${line.category || 'other'}`}>{line.categoryJa || '電文'}</span>
                        <span className="type-pill">{line.type}</span>
                        <span className="log-title-ja">{line.titleJa}</span>
                        <span className="log-meaning-summary">{line.meaning}</span>
                        <span className={`checksum ${line.valid === true ? 'ok' : line.valid === false ? 'bad' : ''}`}>
                          {line.valid === true ? 'OK' : line.valid === false ? 'ERR' : '—'}
                        </span>
                      </div>
                      <div className="log-raw-secondary">
                        <code>{line.rawText || line.text}</code>
                      </div>
                    </div>
                  )}

                  {logDisplayMode === 'summary' && (
                    <div className="log-line-summary">
                      <time>{new Date(line.receivedAt).toLocaleTimeString('ja-JP', { hour12: false })}</time>
                      <span className={`cat-badge ${line.category || 'other'}`}>{line.categoryJa || '電文'}</span>
                      <span className="type-pill">{line.type}</span>
                      <span className="log-title-ja">{line.titleJa}</span>
                      <span className="log-meaning-summary">{line.meaning}</span>
                      <span className={`checksum ${line.valid === true ? 'ok' : line.valid === false ? 'bad' : ''}`}>
                        {line.valid === true ? 'OK' : line.valid === false ? 'ERR' : '—'}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {!isAutoScroll && displayedLogs.length > 0 && (
            <button
              type="button"
              className="scroll-to-latest-btn"
              onClick={scrollToLatest}
              title="最新のログへスクロールして自動追従を再開します"
            >
              <span>{!isNewestFirst ? '⬇ 最新ログへ移動（自動追従 再開）' : '⬆ 最新ログへ移動（自動追従 再開）'}</span>
            </button>
          )}
        </div>
      </section>

      {/* 個別電文 詳細解説モーダル */}
      {selectedLogForModal && selectedLogDefinition && (
        <div className="modal-overlay" onClick={() => setSelectedLogForModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className={`cat-badge ${selectedLogDefinition.category}`}>
                  {selectedLogDefinition.categoryJa}
                </span>
                <h3>{selectedLogDefinition.type} · {selectedLogDefinition.titleJa}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedLogForModal(null)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-section">
                <h4 className="modal-section-title">概要・役割</h4>
                <p className="modal-description">{selectedLogDefinition.description}</p>
              </div>

              <div className="modal-section">
                <h4 className="modal-section-title">受信した生データ ({new Date(selectedLogForModal.receivedAt).toLocaleTimeString('ja-JP')})</h4>
                <pre className="modal-raw-box">{selectedLogForModal.rawText || selectedLogForModal.text}</pre>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ height: '28px', padding: '0 10px', fontSize: '11px' }}
                    onClick={() => handleCopyRawText(selectedLogForModal.rawText || selectedLogForModal.text)}
                  >
                    {copiedLogText ? '✅ コピーしました' : '📋 生テキストをコピー'}
                  </button>
                </div>
              </div>

              <div className="modal-section">
                <h4 className="modal-section-title">この電文の意味・主な値</h4>
                <div style={{ background: '#f8faf9', padding: '10px 12px', borderRadius: '4px', border: '1px solid #e2e8f0', color: '#0f766e', fontWeight: 600, fontSize: '13px' }}>
                  {selectedLogForModal.meaning}
                </div>
              </div>

              {selectedLogDefinition.fields && selectedLogDefinition.fields.length > 0 && (
                <div className="modal-section">
                  <h4 className="modal-section-title">主要フィールド解説</h4>
                  <table className="fields-table">
                    <thead>
                      <tr>
                        <th style={{ width: '130px' }}>項目名</th>
                        <th>解説・単位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLogDefinition.fields.map((f, idx) => (
                        <tr key={idx}>
                          <td className="field-name">{f.name}</td>
                          <td className="field-desc">{f.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 電文リファレンス解説一覧モーダル */}
      {showDictionaryModal && (
        <div className="modal-overlay" onClick={() => setShowDictionaryModal(false)}>
          <div className="modal-content" style={{ maxWidth: '780px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span style={{ fontSize: '18px' }}>📖</span>
                <h3>受信電文リファレンス解説一覧</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDictionaryModal(false)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="dict-filter-bar">
                <input
                  type="text"
                  placeholder="電文名やキーワードで検索 (例: GGA, CLAS, Fix, RTCM...)"
                  value={dictSearchQuery}
                  onChange={(e) => setDictSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(
                  [
                    { id: 'all', label: 'すべて' },
                    { id: 'position', label: '📍 測位・位置' },
                    { id: 'satellite', label: '🛰️ 衛星・精度' },
                    { id: 'clas', label: '📡 CLAS補正' },
                    { id: 'rtk', label: '🌐 RTK補正' },
                    { id: 'system', label: '⚙️ システム' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="secondary-btn"
                    style={{
                      height: '28px',
                      fontSize: '11.5px',
                      backgroundColor: dictCategoryTab === tab.id ? '#0f6a4c' : undefined,
                      color: dictCategoryTab === tab.id ? '#ffffff' : undefined,
                      borderColor: dictCategoryTab === tab.id ? '#0f6a4c' : undefined,
                    }}
                    onClick={() => setDictCategoryTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="dict-grid" style={{ marginTop: '8px' }}>
                {filteredDictDefinitions.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                    該当する電文が見つかりませんでした。
                  </div>
                ) : (
                  filteredDictDefinitions.map((item) => (
                    <div className="dict-card" key={item.type}>
                      <div className="dict-card-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`cat-badge ${item.category}`}>{item.categoryJa}</span>
                          <span className="dict-card-title">{item.type} · {item.titleJa}</span>
                        </div>
                      </div>
                      <div className="dict-card-summary">{item.summary}</div>
                      <div className="dict-card-desc">{item.description}</div>
                      {item.fields && item.fields.length > 0 && (
                        <div style={{ marginTop: '4px', fontSize: '11.5px', color: '#64748b' }}>
                          <b>含まれる主な項目:</b> {item.fields.map((f) => f.name).join('、')}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer>
        <p>
          <a href="mailto:master@futomi.com" className="footer-link">
            © 2026 futomi Co., Ltd. — Futomi Hatano, CEO
          </a>
        </p>
      </footer>
    </main>
  );
}
