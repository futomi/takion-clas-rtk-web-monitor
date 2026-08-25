import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readJsonBody, type ReadableRequest } from '../app/lib/server/requestBody.ts';

const encoder = new TextEncoder();

/**
 * 本文を持つリクエストを組み立てる。
 * `declaredLength` を渡すと Content-Length を実際の長さから意図的にずらせる。
 */
function request(text: string, declaredLength?: number, chunkSize = 1024): ReadableRequest {
  const bytes = encoder.encode(text);
  const length = declaredLength ?? bytes.byteLength;

  return {
    headers: new Headers({ 'content-length': String(length) }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          controller.enqueue(bytes.subarray(offset, offset + chunkSize));
        }
        controller.close();
      },
    }),
  };
}

describe('readJsonBody', () => {
  it('上限内の JSON を解析して返す', async () => {
    const body = await readJsonBody(request('{"host":"rtk2go.com","port":2101}'), 4096);
    assert.deepEqual(body, { host: 'rtk2go.com', port: 2101 });
  });

  it('複数チャンクに分かれていても組み立て直す', async () => {
    const body = await readJsonBody(request('{"mountpoint":"SAKURA_BASE"}', undefined, 4), 4096);
    assert.deepEqual(body, { mountpoint: 'SAKURA_BASE' });
  });

  it('マルチバイト文字を壊さない', async () => {
    const body = await readJsonBody(request('{"mountpoint":"さくら基準局"}', undefined, 3), 4096);
    assert.deepEqual(body, { mountpoint: 'さくら基準局' });
  });

  it('Content-Length が上限を超えていれば読まずに諦める', async () => {
    assert.equal(await readJsonBody(request(`{"a":"${'x'.repeat(200)}"}`), 64), null);
  });

  it('Content-Length が嘘でも実測で打ち切る', async () => {
    // 宣言だけ小さくしても、実際に流れてきた量で判定する
    const oversized = request(`{"a":"${'x'.repeat(200)}"}`, 10);
    assert.equal(await readJsonBody(oversized, 64), null);
  });

  it('JSON として読めなければ null', async () => {
    assert.equal(await readJsonBody(request('not json'), 4096), null);
  });

  it('本文が無ければ null', async () => {
    assert.equal(await readJsonBody({ headers: new Headers(), body: null }, 4096), null);
  });
});
