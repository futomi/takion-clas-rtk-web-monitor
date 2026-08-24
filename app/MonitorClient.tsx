'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapPanel from './MapPanel';

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
  hdop?: number; pdop?: number; vdop?: number; speedKmh?: number; course?: number;
  timeUtc?: string; dateUtc?: string; horizontalError?: number; verticalError?: number;
  lastReceivedAt?: number;
};
type ParsedLine = { type: string; valid: boolean | null; update: Partial<Telemetry>; summary?: string };
type LogLine = { id: number; receivedAt: number; text: string; type: string; valid: boolean | null };
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

const UBLOX_VENDOR_ID = 0x1546;
const MAX_LOG_LINES = 240;
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
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}${fraction} UTC`;
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
    case 'GSA':
      update.pdop = parseNumber(fields[15]);
      update.hdop = parseNumber(fields[16]);
      update.vdop = parseNumber(fields[17]);
      break;
    case 'GSV':
      update.satellitesInView = parseNumber(fields[3]);
      break;
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
    update.timeUtc = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')} UTC`;
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

export default function MonitorClient({
  mapboxAccessToken,
  mapboxTokenError,
}: {
  mapboxAccessToken: string;
  mapboxTokenError?: string;
}) {
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [baudRate, setBaudRate] = useState(38400);
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [portInfo, setPortInfo] = useState<SerialPortInfo>({});
  const [lineCount, setLineCount] = useState(0);
  const [byteCount, setByteCount] = useState(0);
  const [clock, setClock] = useState(0);
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
  const logIdRef = useRef(0);

  const serial = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { serial?: SerialApi }).serial;
  const isSupported = Boolean(serial);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const consumeLines = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    const receivedAt = Date.now();
    const combinedUpdate: Partial<Telemetry> = { lastReceivedAt: receivedAt };
    const entries: LogLine[] = [];
    for (const text of lines) {
      const clean = text.trim();
      if (!clean) continue;
      const parsed = parseNmea(clean);
      Object.assign(combinedUpdate, parsed.update);
      entries.push({ id: logIdRef.current++, receivedAt, text: clean, type: parsed.type, valid: parsed.valid });
    }
    if (entries.length === 0) return;
    setTelemetry((current) => ({ ...current, ...combinedUpdate }));
    setLineCount((current) => current + entries.length);
    if (!pausedRef.current) setLogs((current) => [...entries.reverse(), ...current].slice(0, MAX_LOG_LINES));
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

    setTelemetry((current) => ({ ...current, ...parsed.update, lastReceivedAt: receivedAt }));
    setLineCount((current) => current + 1);
    if (!pausedRef.current) {
      const entry: LogLine = {
        id: logIdRef.current++,
        receivedAt,
        text: parsed.summary ?? `UBX-${parsed.type} · ${frame.length - 8} byte payload`,
        type: parsed.type,
        valid: parsed.valid,
      };
      setLogs((current) => [entry, ...current].slice(0, MAX_LOG_LINES));
    }
  }, [enablePvtOutputIfReady]);

  const consumeRtcmFrame = useCallback((frame: Uint8Array) => {
    const receivedAt = Date.now();
    const parsed = parseRtcm(frame);
    setTelemetry((current) => ({ ...current, lastReceivedAt: receivedAt }));
    setLineCount((current) => current + 1);
    if (!pausedRef.current) {
      const entry: LogLine = {
        id: logIdRef.current++,
        receivedAt,
        text: parsed.summary ?? 'RTCM3 frame',
        type: parsed.type,
        valid: parsed.valid,
      };
      setLogs((current) => [entry, ...current].slice(0, MAX_LOG_LINES));
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

  const disconnect = useCallback(async (unexpected = false) => {
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
      setConnection('idle');
    }
  }, []);

  useEffect(() => () => {
    keepReadingRef.current = false;
    void readerRef.current?.cancel();
  }, []);

  const connect = async () => {
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

  const quality = qualityLabels[telemetry.quality ?? 0] ?? { label: `測位品質 ${telemetry.quality}`, short: `Q${telemetry.quality}`, tone: 'single' };
  const hasPosition = telemetry.latitude !== undefined && telemetry.longitude !== undefined;
  const lastAge = telemetry.lastReceivedAt === undefined ? 'データ待ち' : `${Math.max(0, Math.floor((clock - telemetry.lastReceivedAt) / 1000))}秒前`;
  const latestTypes = useMemo(() => {
    const counts = new Map<string, number>();
    logs.forEach((line) => counts.set(line.type, (counts.get(line.type) ?? 0) + 1));
    return [...counts.entries()].slice(0, 5);
  }, [logs]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div><p className="eyebrow">QZSS / CLAS RECEIVER</p><h1>CLAS Monitor</h1></div>
        </div>
        <div className="header-status">
          <span className="local-data">LOCAL PROCESSING</span>
          <div className={`connection-chip ${connection}`}><span className="status-dot" />{connection === 'connected' ? '接続中' : connection === 'connecting' ? '接続中…' : '未接続'}</div>
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

      {error && <div className="error-banner" role="alert"><strong>接続エラー</strong><span>{error}</span><button onClick={() => setError('')}>閉じる</button></div>}

      <section className="dashboard" aria-label="測位情報">
        <article className="position-panel panel">
          <div className="panel-heading"><div><p className="card-label">POSITION</p><h3>現在位置</h3></div><span className={`fix-badge ${quality.tone}`}>{quality.short}</span></div>
          <div className={`coordinate-display ${hasPosition ? 'has-position' : ''}`}>
            <div className="coordinate-row"><span className="axis">LAT</span><strong>{telemetry.latitude === undefined ? '— — —' : Math.abs(telemetry.latitude).toFixed(9)}</strong><span className="direction">{telemetry.latitude === undefined ? '' : telemetry.latitude >= 0 ? 'N' : 'S'}</span></div>
            <div className="coordinate-row"><span className="axis">LON</span><strong>{telemetry.longitude === undefined ? '— — —' : Math.abs(telemetry.longitude).toFixed(9)}</strong><span className="direction">{telemetry.longitude === undefined ? '' : telemetry.longitude >= 0 ? 'E' : 'W'}</span></div>
          </div>
          <div className="position-meta"><div><span>標高</span><strong>{formatValue(telemetry.altitude, 3, ' m')}</strong></div><div><span>推定水平誤差</span><strong>{formatValue(telemetry.horizontalError, 3, ' m')}</strong></div><div><span>UTC</span><strong>{telemetry.timeUtc ?? '—'}</strong></div></div>
        </article>

        <article className="fix-panel panel">
          <div className="panel-heading"><div><p className="card-label">SOLUTION STATUS</p><h3>測位ステータス</h3></div><span className={`signal-orbit ${connection === 'connected' ? 'active' : ''}`} aria-hidden="true"><i /><i /><i /></span></div>
          <div className="fix-state"><span className={`fix-indicator ${quality.tone}`} /><div><strong>{quality.label}</strong><span>{connection === 'connected' ? `最終受信 ${lastAge}` : '受信機を接続してください'}</span></div></div>
          <dl className="stat-list"><div><dt>使用衛星</dt><dd>{telemetry.satellitesUsed ?? '—'} <small>SV</small></dd></div><div><dt>可視衛星</dt><dd>{telemetry.satellitesInView ?? '—'} <small>SV</small></dd></div><div><dt>HDOP</dt><dd>{formatValue(telemetry.hdop, 2)}</dd></div><div><dt>PDOP / VDOP</dt><dd>{formatValue(telemetry.pdop, 2)} / {formatValue(telemetry.vdop, 2)}</dd></div></dl>
        </article>

        <article className="motion-panel panel">
          <p className="card-label">MOTION</p><h3>移動情報</h3>
          <div className="speed-value"><strong>{formatValue(telemetry.speedKmh, 1)}</strong><span>km/h</span></div>
          <div className="course-line"><span>進行方向</span><strong>{formatValue(telemetry.course, 1, '°')}</strong></div>
          <div className="course-rule"><span style={{ transform: `translateX(${Math.min(100, Math.max(0, (telemetry.course ?? 0) / 3.6))}%)` }} /></div>
          <div className="date-line"><span>測位日</span><strong>{telemetry.dateUtc ?? '—'}</strong></div>
        </article>
      </section>

      <section className="map-panel panel" aria-label="現在地マップ">
        <div className="map-panel-heading">
          <div>
            <p className="card-label">LIVE POSITION MAP</p>
            <h3>現在地マップ</h3>
          </div>
          <div className="map-panel-status">
            <span className={`fix-indicator ${quality.tone}`} />
            <span>{hasPosition ? `${quality.short} · ${formatValue(telemetry.horizontalError, 2, ' m')}` : '測位データ待ち'}</span>
          </div>
        </div>
        <MapPanel
          accessToken={mapboxAccessToken}
          tokenError={mapboxTokenError}
          latitude={telemetry.latitude}
          longitude={telemetry.longitude}
          horizontalError={telemetry.horizontalError}
          course={telemetry.course}
          qualityTone={quality.tone}
        />
      </section>

      <section className="log-panel panel" aria-label="受信ログ">
        <div className="log-heading"><div><p className="card-label">LIVE DATA STREAM</p><h3>受信ログ</h3></div><div className="log-actions"><button onClick={() => setPaused((value) => !value)}>{paused ? '表示を再開' : '表示を一時停止'}</button><button onClick={() => setLogs([])}>クリア</button></div></div>
        <div className="log-summary"><div><span>受信フレーム</span><strong>{lineCount.toLocaleString()}</strong></div><div><span>受信サイズ</span><strong>{(byteCount / 1024).toFixed(1)} KB</strong></div><div className="sentence-chips">{latestTypes.length > 0 ? latestTypes.map(([type, count]) => <span key={type}>{type} <b>{count}</b></span>) : <span>データ待ち</span>}</div></div>
        <div className="terminal" aria-live="polite" aria-label="受信した測位データ">
          {logs.length === 0 ? <div className="terminal-empty"><span className="terminal-cursor" /><p>受信機に接続すると、判別できた測位データが流れます。</p></div> : logs.map((line) => <div className="log-line" key={line.id}><time>{new Date(line.receivedAt).toLocaleTimeString('ja-JP', { hour12: false })}</time><span className="log-type">{line.type}</span><code>{line.text}</code><span className={`checksum ${line.valid === true ? 'ok' : line.valid === false ? 'bad' : ''}`}>{line.valid === true ? 'OK' : line.valid === false ? 'ERR' : '—'}</span></div>)}
        </div>
      </section>

      <footer><p>TakionCM001 · ZED-F9P + NEO-D9C</p><p>Web Serial / UBX + NMEA + RTCM3</p></footer>
    </main>
  );
}
