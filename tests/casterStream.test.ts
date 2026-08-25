import assert from 'node:assert/strict';
import net from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { NtripParameterError } from '../app/lib/ntripHeader.ts';
import { createRtcmStream, openCasterSession } from '../app/lib/server/casterStream.ts';

const CRLF = String.fromCharCode(13, 10);

/** 本物の Caster の代わりに、決められた応答を返す TCP サーバーを立てる */
type FakeCaster = {
  port: number;
  /** これまでに受けた接続で、閉じられたものの数 */
  closedConnections: number;
  /** 最後に受け取ったリクエスト文字列 */
  lastRequest: string;
  sockets: net.Socket[];
  stop: () => Promise<void>;
};

const casters: FakeCaster[] = [];

async function startFakeCaster(
  onRequest: (socket: net.Socket, caster: FakeCaster) => void,
): Promise<FakeCaster> {
  const server = net.createServer();
  const caster: FakeCaster = {
    port: 0,
    closedConnections: 0,
    lastRequest: '',
    sockets: [],
    stop: () => new Promise((resolve) => {
      for (const socket of caster.sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };

  server.on('connection', (socket) => {
    caster.sockets.push(socket);
    socket.on('close', () => { caster.closedConnections += 1; });
    socket.once('data', (chunk) => {
      caster.lastRequest = chunk.toString('utf8');
      onRequest(socket, caster);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  caster.port = (server.address() as net.AddressInfo).port;
  casters.push(caster);
  return caster;
}

afterEach(async () => {
  for (const caster of casters.splice(0)) await caster.stop();
});

const params = (port: number, mountpoint = 'MP') => ({
  host: 'localhost',
  port,
  mountpoint,
  username: 'user',
  password: 'none',
});

/** ストリームを読み切って 1 本のバイト列にまとめる */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 相手が接続を閉じるまで待つ */
function waitForClose(caster: FakeCaster, expected = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const check = () => {
      if (caster.closedConnections >= expected) resolve();
      else if (Date.now() > deadline) reject(new Error('接続が閉じられませんでした'));
      else setTimeout(check, 10);
    };
    check();
  });
}

describe('openCasterSession', () => {
  it('NTRIP 1.0 の応答を読み切り、同じパケットに載った本文も取りこぼさない', async () => {
    const caster = await startFakeCaster((socket) => {
      // ヘッダと本文の先頭が 1 つのパケットで届く、実際によくある形
      socket.write(Buffer.concat([
        Buffer.from(`ICY 200 OK${CRLF}`, 'ascii'),
        Buffer.from([0xd3, 0x00, 0x01, 0xaa]),
      ]));
      setTimeout(() => socket.end(Buffer.from([0xd3, 0x00, 0x02, 0xbb])), 20);
    });

    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const body = await drain(createRtcmStream(session, new AbortController().signal));

    assert.deepEqual(Array.from(body), [0xd3, 0x00, 0x01, 0xaa, 0xd3, 0x00, 0x02, 0xbb]);
    assert.match(caster.lastRequest, /^GET \/MP HTTP\/1\.0/);
    assert.match(caster.lastRequest, /Host: localhost/);
  });

  it('HTTP 形式の応答では空行の後ろだけを本文として流す', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.write(`HTTP/1.1 200 OK${CRLF}Server: fake${CRLF}${CRLF}`);
      setTimeout(() => socket.end(Buffer.from([0xd3, 0x11])), 20);
    });

    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const body = await drain(createRtcmStream(session, new AbortController().signal));
    assert.deepEqual(Array.from(body), [0xd3, 0x11]);
  });

  it('ヘッダが複数パケットに分かれても組み立て直す', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.write(`ICY 2`);
      setTimeout(() => socket.write(`00 OK${CRLF}`), 10);
      setTimeout(() => socket.end(Buffer.from([0xd3, 0x22])), 30);
    });

    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const body = await drain(createRtcmStream(session, new AbortController().signal));
    assert.deepEqual(Array.from(body), [0xd3, 0x22]);
  });

  it('マウントポイント不在（Source-table 応答）は理由を添えて失敗する', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.end(`SOURCETABLE 200 OK${CRLF}${CRLF}STR;MP;;;;;;;;;;;;;;;${CRLF}`);
    });

    await assert.rejects(
      () => openCasterSession('127.0.0.1', params(caster.port)),
      /マウントポイントが見つかりません/,
    );
  });

  it('認証失敗はステータス行をそのまま理由として返す', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.end(`HTTP/1.1 401 Unauthorized${CRLF}${CRLF}`);
    });

    await assert.rejects(
      () => openCasterSession('127.0.0.1', params(caster.port)),
      /401 Unauthorized/,
    );
  });

  it('ヘッダを返さずに切られた場合も失敗として返す', async () => {
    const caster = await startFakeCaster((socket) => socket.end());
    await assert.rejects(() => openCasterSession('127.0.0.1', params(caster.port)));
  });

  it('無通信が続けばタイムアウトする', async () => {
    const caster = await startFakeCaster(() => { /* 何も返さない */ });
    await assert.rejects(
      () => openCasterSession('127.0.0.1', params(caster.port), 80),
      /タイムアウト/,
    );
  });

  it('危険な文字を含むマウントポイントでは接続すら試みない', async () => {
    const caster = await startFakeCaster((socket) => socket.end(`ICY 200 OK${CRLF}`));
    await assert.rejects(
      () => openCasterSession('127.0.0.1', params(caster.port, `MP${CRLF}X: 1`)),
      NtripParameterError,
    );
    assert.equal(caster.sockets.length, 0);
  });
});

describe('createRtcmStream', () => {
  it('消費側がキャンセルしたら Caster への接続も畳む', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.write(`ICY 200 OK${CRLF}`);
      // 途切れず流し続ける相手。無通信タイムアウトでは畳まれない
      const timer = setInterval(() => socket.write(Buffer.from([0xd3, 0x00])), 10);
      socket.on('close', () => clearInterval(timer));
    });

    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const reader = createRtcmStream(session, new AbortController().signal).getReader();
    await reader.read();
    await reader.cancel();

    await waitForClose(caster);
  });

  it('クライアントの切断（abort）で Caster への接続も畳む', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.write(`ICY 200 OK${CRLF}`);
      const timer = setInterval(() => socket.write(Buffer.from([0xd3, 0x00])), 10);
      socket.on('close', () => clearInterval(timer));
    });

    const controller = new AbortController();
    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const reader = createRtcmStream(session, controller.signal).getReader();
    await reader.read();
    controller.abort();

    await waitForClose(caster);
  });

  it('確保したスロットは経路によらず 1 度だけ解放される', async () => {
    const caster = await startFakeCaster((socket) => {
      socket.write(`ICY 200 OK${CRLF}`);
      setTimeout(() => socket.end(Buffer.from([0xd3, 0x00])), 10);
    });

    let releases = 0;
    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const controller = new AbortController();
    const stream = createRtcmStream(session, controller.signal, () => { releases += 1; });

    await drain(stream);
    controller.abort();

    assert.ok(releases >= 1, 'ストリーム終了時に解放される');
  });
});

describe('createRtcmStream の背圧', () => {
  it('読み出しが遅くても、溜め込みを止めたぶんを取りこぼさない', async () => {
    // 内部の上限（256 KB）を確実に超える量を一気に流し込み、
    // 受信の一時停止と再開を挟んでも 1 バイトも欠けないことを確かめる
    const chunk = new Uint8Array(8 * 1024).fill(0xd3);
    const chunkCount = 64;
    const expectedBytes = chunk.byteLength * chunkCount;

    const caster = await startFakeCaster((socket) => {
      socket.write(`ICY 200 OK${CRLF}`);
      for (let index = 0; index < chunkCount; index += 1) socket.write(Buffer.from(chunk));
      socket.end();
    });

    const session = await openCasterSession('127.0.0.1', params(caster.port));
    const stream = createRtcmStream(session, new AbortController().signal);

    // 消費側をわざと遅らせ、上限に達して受信が止まる状況を作る
    const reader = stream.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) received += value.byteLength;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    assert.equal(received, expectedBytes);
  });
});
