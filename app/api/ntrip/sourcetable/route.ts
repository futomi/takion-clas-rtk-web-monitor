import { NextRequest, NextResponse } from 'next/server';
import * as net from 'net';

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

function parseSourceTable(rawText: string): MountpointRecord[] {
  const lines = rawText.split(/\r?\n/);
  const records: MountpointRecord[] = [];

  for (const line of lines) {
    if (!line.startsWith('STR;')) continue;
    const parts = line.split(';');
    if (parts.length < 12) continue;

    const latRaw = parseFloat(parts[9] || '');
    const lonRaw = parseFloat(parts[10] || '');

    const record: MountpointRecord = {
      mountpoint: parts[1] || '',
      identifier: parts[2] || '',
      format: parts[3] || '',
      formatDetails: parts[4] || '',
      carrier: parseInt(parts[5] || '0', 10) || 0,
      navSystem: parts[6] || '',
      network: parts[7] || '',
      country: parts[8] || '',
      latitude: Number.isFinite(latRaw) ? latRaw : null,
      longitude: Number.isFinite(lonRaw) ? lonRaw : null,
      nmea: parts[11] === '1',
      solution: parseInt(parts[12] || '0', 10) || 0,
      generator: parts[13] || '',
      authentication: parts[15] || 'N',
      fee: parts[16] === 'Y',
      bitrate: parseInt(parts[17] || '0', 10) || 0,
    };

    if (record.mountpoint) {
      records.push(record);
    }
  }

  return records;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const host = searchParams.get('host') || 'rtk2go.com';
  const port = parseInt(searchParams.get('port') || '2101', 10);

  if (!host || isNaN(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: '無効なホスト名またはポート番号です。' }, { status: 400 });
  }

  try {
    const rawData = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const socket = net.createConnection({ host, port }, () => {
        const req = `GET / HTTP/1.0\r\nUser-Agent: TakionCLAS-RTK-WebMonitor/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n`;
        socket.write(req);
      });

      socket.setTimeout(8000);
      socket.setEncoding('utf8');

      socket.on('data', (chunk) => {
        buffer += chunk;
      });

      socket.on('end', () => {
        resolve(buffer);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('NTRIP Casterへの接続がタイムアウトしました。'));
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });

    const records = parseSourceTable(rawData);
    return NextResponse.json({
      host,
      port,
      count: records.length,
      records,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Source-tableの取得に失敗しました。',
      },
      { status: 502 }
    );
  }
}
