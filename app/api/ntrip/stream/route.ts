import { NextRequest } from 'next/server';
import * as net from 'net';

export async function GET(request: NextRequest) {
  return handleNtripStream(request);
}

export async function POST(request: NextRequest) {
  return handleNtripStream(request);
}

async function handleNtripStream(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let host = searchParams.get('host');
  let port = parseInt(searchParams.get('port') || '2101', 10);
  let mountpoint = searchParams.get('mountpoint');
  let username = searchParams.get('username') || '';
  let password = searchParams.get('password') || 'none';
  let gga = searchParams.get('gga') || '';

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body.host) host = body.host;
      if (body.port) port = parseInt(body.port, 10);
      if (body.mountpoint) mountpoint = body.mountpoint;
      if (body.username !== undefined) username = body.username;
      if (body.password !== undefined) password = body.password;
      if (body.gga !== undefined) gga = body.gga;
    } catch {
      // JSON parse error, ignore and use query params
    }
  }

  if (!host || !mountpoint || isNaN(port) || port < 1 || port > 65535) {
    return new Response(JSON.stringify({ error: 'ホスト名、ポート番号、マウントポイント名は必須です。' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // クライアントへのストリーミングレスポンスを作成
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let headerPassed = false;
      let headerBuffer = Buffer.alloc(0);
      let socket: net.Socket | null = null;

      try {
        socket = net.createConnection({ host, port }, () => {
          let req = `GET /${mountpoint} HTTP/1.0\r\n`;
          req += `User-Agent: TakionCLAS-RTK-WebMonitor/1.0\r\n`;
          req += `Accept: */*\r\n`;
          if (username || password) {
            const auth = Buffer.from(`${username}:${password}`).toString('base64');
            req += `Authorization: Basic ${auth}\r\n`;
          }
          if (gga && gga.startsWith('$')) {
            req += `${gga.trim()}\r\n`;
          }
          req += `Connection: close\r\n\r\n`;

          socket?.write(req);
        });

        socket.setTimeout(12000);

        socket.on('data', (chunk: Buffer) => {
          if (!headerPassed) {
            headerBuffer = Buffer.concat([headerBuffer, chunk]);

            let headerEndIndex = -1;
            let headerLength = 0;

            const doubleNewlineIndex = headerBuffer.indexOf('\r\n\r\n');
            const singleNewlineIndex = headerBuffer.indexOf('\r\n');

            const headerPreview = headerBuffer.toString('utf8', 0, Math.min(128, headerBuffer.length));

            // NTRIP 1.0 (ICY 200 OK\r\n) は改行1回で直後にバイナリが流れる
            if (headerPreview.toUpperCase().startsWith('ICY 200') && singleNewlineIndex !== -1) {
              headerEndIndex = singleNewlineIndex;
              headerLength = 2;
            } else if (doubleNewlineIndex !== -1) {
              // 標準HTTP (HTTP/1.1 200 OK\r\n...\r\n\r\n)
              headerEndIndex = doubleNewlineIndex;
              headerLength = 4;
            } else if (singleNewlineIndex !== -1 && (headerPreview.startsWith('HTTP/') || headerPreview.startsWith('SOURCETABLE'))) {
              const firstLine = headerPreview.split('\r\n')[0] || '';
              if (!firstLine.includes('200') && !firstLine.toUpperCase().includes('OK')) {
                controller.error(new Error(`NTRIP Casterエラー: ${firstLine}`));
                socket?.destroy();
                return;
              }
            }

            if (headerEndIndex !== -1) {
              headerPassed = true;
              const headerText = headerBuffer.subarray(0, headerEndIndex).toString('utf8');
              const bodyRemaining = headerBuffer.subarray(headerEndIndex + headerLength);

              const firstLine = headerText.split('\r\n')[0] || '';
              if (
                !firstLine.includes('200') &&
                !firstLine.toUpperCase().includes('ICY 200') &&
                !firstLine.toUpperCase().includes('OK')
              ) {
                controller.error(new Error(`NTRIP Casterエラー: ${firstLine}`));
                socket?.destroy();
                return;
              }

              if (bodyRemaining.length > 0) {
                controller.enqueue(new Uint8Array(bodyRemaining));
              }
            }
          } else {
            controller.enqueue(new Uint8Array(chunk));
          }
        });

        socket.on('end', () => {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });

        socket.on('error', (err) => {
          try {
            controller.error(err);
          } catch {
            // Already closed
          }
        });

        socket.on('timeout', () => {
          socket?.destroy();
          try {
            controller.error(new Error('NTRIPストリームの受信がタイムアウトしました。'));
          } catch {
            // Already closed
          }
        });

        // クライアントが切断した場合のハンドリング
        request.signal.addEventListener('abort', () => {
          socket?.destroy();
        });
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error('接続に失敗しました。'));
      }
    },
    cancel() {
      // Stream cancelled by reader
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
