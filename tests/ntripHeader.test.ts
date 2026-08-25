import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_CREDENTIAL_LENGTH,
  MAX_HEADER_BYTES,
  MAX_MOUNTPOINT_LENGTH,
  NtripParameterError,
  buildNtripStreamRequest,
  buildSourceTableRequest,
  parseNtripResponseHeader,
} from '../app/lib/ntripHeader.ts';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

describe('parseNtripResponseHeader', () => {
  it('NTRIP 1.0 (ICY 200 OK) は改行 1 回で本文が始まる', () => {
    const buffer = bytes('ICY 200 OK\r\n\xd3\x00\x13');
    const result = parseNtripResponseHeader(buffer);
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' && result.bodyOffset, 'ICY 200 OK\r\n'.length);
  });

  it('HTTP 応答は空行までをヘッダとして読み飛ばす', () => {
    const header = 'HTTP/1.1 200 OK\r\nServer: NTRIP Caster\r\nContent-Type: gnss/data\r\n\r\n';
    const result = parseNtripResponseHeader(bytes(`${header}BODY`));
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' && result.bodyOffset, header.length);
  });

  it('ヘッダが途中までしか届いていなければ pending を返す', () => {
    assert.equal(parseNtripResponseHeader(bytes('HTTP/1.1 200 OK\r\nServer: NTRIP')).status, 'pending');
    assert.equal(parseNtripResponseHeader(bytes('ICY 200')).status, 'pending');
    assert.equal(parseNtripResponseHeader(new Uint8Array(0)).status, 'pending');
  });

  it('401 などの失敗ステータスをエラーとして返す', () => {
    const result = parseNtripResponseHeader(bytes('HTTP/1.1 401 Unauthorized\r\n\r\n'));
    assert.equal(result.status, 'error');
    assert.match(result.status === 'error' ? result.message : '', /401 Unauthorized/);
  });

  it('空行を待たずステータス行の時点で失敗を確定できる', () => {
    const result = parseNtripResponseHeader(bytes('HTTP/1.1 404 Not Found\r\nServer: x'));
    assert.equal(result.status, 'error');
  });

  it('Source-table が返ってきた場合はマウントポイント不在として扱う', () => {
    // ステータス行に 200 を含むため、成功と誤認して本文を垂れ流さないことを確認する
    const result = parseNtripResponseHeader(bytes('SOURCETABLE 200 OK\r\nServer: NTRIP\r\n\r\nSTR;A;...'));
    assert.equal(result.status, 'error');
    assert.match(result.status === 'error' ? result.message : '', /マウントポイントが見つかりません/);
  });

  it('理由句に OK を含む失敗応答を成功と取り違えない', () => {
    // ステータスコードを数値として読まず行全体を検索すると、これを成功と誤判定する
    const result = parseNtripResponseHeader(bytes('HTTP/1.1 503 Service Not OK\r\n\r\n'));
    assert.equal(result.status, 'error');
  });

  it('2xx 以外は本文を待たずに失敗とする', () => {
    assert.equal(parseNtripResponseHeader(bytes('HTTP/1.1 302 Found\r\n\r\n')).status, 'error');
    assert.equal(parseNtripResponseHeader(bytes('HTTP/1.1 500 Internal Server Error\r\n\r\n')).status, 'error');
  });

  it('200 以外の 2xx は成功として扱う', () => {
    const result = parseNtripResponseHeader(bytes('HTTP/1.1 206 Partial Content\r\n\r\nBODY'));
    assert.equal(result.status, 'ok');
  });

  it('ヘッダ終端が来ないまま肥大化したらエラーにする', () => {
    const flood = bytes(`X${'a'.repeat(MAX_HEADER_BYTES + 10)}`);
    assert.equal(parseNtripResponseHeader(flood).status, 'error');
  });

  it('ICY を名乗ったまま改行を送らない相手も上限で打ち切る', () => {
    // ICY は改行 1 回で本文へ移る。この分岐で pending を返し続けると、
    // 呼び出し側のヘッダバッファが際限なく伸びてしまう
    const flood = bytes(`ICY 200 OK${'a'.repeat(MAX_HEADER_BYTES + 10)}`);
    assert.equal(parseNtripResponseHeader(flood).status, 'error');
  });

  it('ヘッダと大きな本文が同じチャンクで届いても上限に巻き込まれない', () => {
    // 上限はあくまで「ヘッダ終端が来ない」ことへの歯止め。終端が読めている限り、
    // 同じチャンクに何バイト本文が続いていても成功として扱う
    const header = 'ICY 200 OK\r\n';
    const icy = parseNtripResponseHeader(bytes(`${header}${'\xd3'.repeat(MAX_HEADER_BYTES * 2)}`));
    assert.equal(icy.status, 'ok');
    assert.equal(icy.status === 'ok' && icy.bodyOffset, header.length);

    const httpHeader = 'HTTP/1.1 200 OK\r\n\r\n';
    const http = parseNtripResponseHeader(bytes(`${httpHeader}${'\xd3'.repeat(MAX_HEADER_BYTES * 2)}`));
    assert.equal(http.status, 'ok');
    assert.equal(http.status === 'ok' && http.bodyOffset, httpHeader.length);
  });

  it('相手が返した長大なステータス行はそのまま提示しない', () => {
    const result = parseNtripResponseHeader(bytes(`HTTP/1.1 403 ${'x'.repeat(4000)}\r\n\r\n`));
    assert.equal(result.status, 'error');
    const message = result.status === 'error' ? result.message : '';
    assert.ok(message.length < 300, `got ${message.length} chars`);
    assert.match(message, /^NTRIP Casterエラー: HTTP\/1\.1 403 x+…$/);
  });

  it('本文が 0 バイトでもヘッダ位置を正しく返す', () => {
    const header = 'ICY 200 OK\r\n';
    const result = parseNtripResponseHeader(bytes(header));
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' && result.bodyOffset, header.length);
  });
});

describe('buildNtripStreamRequest / buildSourceTableRequest', () => {
  it('マウントポイントと Host ヘッダを含む GET を組み立てる', () => {
    const request = buildNtripStreamRequest('SAKURA', 'rtk2go.com', '', '');
    assert.match(request, /^GET \/SAKURA HTTP\/1\.0\r\n/);
    assert.match(request, /Host: rtk2go\.com\r\n/);
    assert.ok(request.endsWith('\r\n\r\n'));
  });

  it('認証情報があれば Basic 認証ヘッダを付ける', () => {
    const request = buildNtripStreamRequest('SAKURA', 'rtk2go.com', 'user@example.com', 'none');
    const expected = Buffer.from('user@example.com:none').toString('base64');
    assert.match(request, new RegExp(`Authorization: Basic ${expected}`));
  });

  it('認証情報が空なら Authorization ヘッダを付けない', () => {
    assert.doesNotMatch(buildNtripStreamRequest('SAKURA', 'rtk2go.com', '', ''), /Authorization/);
  });

  it('Source-table 要求はルートへの GET で認証を伴わない', () => {
    const request = buildSourceTableRequest('rtk2go.com');
    assert.match(request, /^GET \/ HTTP\/1\.0\r\n/);
    assert.doesNotMatch(request, /Authorization/);
    assert.ok(request.endsWith('\r\n\r\n'));
  });

  it('どちらの要求も NTRIP 慣例どおりの User-Agent を名乗る', () => {
    // "NTRIP " 始まりでクライアント種別を判定する Caster があるため、2 経路で名前を揃える
    assert.match(buildSourceTableRequest('rtk2go.com'), /User-Agent: NTRIP /);
    assert.match(buildNtripStreamRequest('SAKURA', 'rtk2go.com', '', ''), /User-Agent: NTRIP /);
  });
});

describe('リクエストへ埋め込む値の検査', () => {
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  // 通してしまうと 1 本の GET を任意個のリクエストへ分割でき、
  // SSRF 検査を通ったホストへ任意のバイト列を送り込む踏み台にされる
  const INJECTIONS = [
    `mp${CR}${LF}X-Injected: 1`,
    `mp${LF}X-Injected: 1`,
    `mp${CR}X-Injected: 1`,
    'mp HTTP/1.0',
    'mp name',
  ];

  for (const injection of INJECTIONS) {
    it(`マウントポイント ${JSON.stringify(injection)} を拒否する`, () => {
      assert.throws(
        () => buildNtripStreamRequest(injection, 'rtk2go.com', 'user', 'pass'),
        NtripParameterError,
      );
    });
  }

  it('ホスト名に混ぜられた改行も拒否する', () => {
    assert.throws(() => buildSourceTableRequest(`rtk2go.com${CR}${LF}X: 1`), NtripParameterError);
    assert.throws(() => buildNtripStreamRequest('SAKURA', `a.com${CR}${LF}X: 1`, '', ''), NtripParameterError);
  });

  it('認証情報は Base64 を通るため、改行を含んでいてもヘッダの外へ出ない', () => {
    const request = buildNtripStreamRequest('SAKURA', 'rtk2go.com', `user${CR}${LF}X: 1`, 'pass word');
    assert.doesNotMatch(request, /X: 1/);
    assert.equal(request.split(CR + LF).filter((line) => line.startsWith('Authorization:')).length, 1);
  });

  it('通常の名前と、空白を含むパスワードはそのまま通す', () => {
    const request = buildNtripStreamRequest('SAKURA_BASE-01', 'ntrip.example.jp', 'u@example.com', 'pass word');
    assert.ok(request.startsWith(`GET /SAKURA_BASE-01 HTTP/1.0${CR}${LF}`));
    assert.ok(request.includes(`Host: ntrip.example.jp${CR}${LF}`));
    const expected = Buffer.from('u@example.com:pass word').toString('base64');
    assert.ok(request.includes(`Authorization: Basic ${expected}`));
  });
});

describe('リクエストへ埋め込む値の長さ制限', () => {
  // 文字種だけを見て長さを見ないと、サーバーに数 MB のリクエストを
  // 第三者の Caster へ送らせる踏み台にできてしまう
  it('長すぎるマウントポイント名を拒否する', () => {
    const longName = 'A'.repeat(MAX_MOUNTPOINT_LENGTH + 1);
    assert.throws(
      () => buildNtripStreamRequest(longName, 'rtk2go.com', '', ''),
      NtripParameterError,
    );
  });

  it('上限ちょうどのマウントポイント名は通す', () => {
    const name = 'A'.repeat(MAX_MOUNTPOINT_LENGTH);
    assert.ok(buildNtripStreamRequest(name, 'rtk2go.com', '', '').startsWith(`GET /${name} `));
  });

  it('長すぎるユーザー名・パスワードを拒否する', () => {
    const long = 'x'.repeat(MAX_CREDENTIAL_LENGTH + 1);
    assert.throws(() => buildNtripStreamRequest('MP', 'rtk2go.com', long, 'none'), NtripParameterError);
    assert.throws(() => buildNtripStreamRequest('MP', 'rtk2go.com', 'user', long), NtripParameterError);
  });

  it('長すぎるホスト名を拒否する', () => {
    assert.throws(() => buildSourceTableRequest(`${'a'.repeat(254)}.com`), NtripParameterError);
  });
});
