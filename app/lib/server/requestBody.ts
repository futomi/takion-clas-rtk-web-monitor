/**
 * リクエストボディを上限付きで読む。
 *
 * `request.json()` は本文を丸ごとメモリへ読み込むため、上限が無いと巨大な本文ひとつで
 * プロセスのメモリを食い潰せてしまう。`Content-Length` は省略も詐称もできるので、
 * 宣言値で足切りしたうえで、実際に読んだバイト数でも打ち切る。
 *
 * `next/server` に依存しないよう、必要なプロパティだけを構造的に受け取る。
 */

/** 本文を読むのに必要な部分だけを取り出した `Request` の形 */
export type ReadableRequest = {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

/**
 * 本文を上限付きで読み、JSON として解釈する。
 *
 * @returns 解析結果。本文が無い・上限を超えた・JSON として読めない場合はいずれも `null`
 */
export async function readJsonBody(request: ReadableRequest, maxBytes: number): Promise<unknown> {
  const text = await readBodyText(request, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 本文を上限付きで読み、UTF-8 文字列として返す。上限を超えたら読み切らずに `null` */
async function readBodyText(request: ReadableRequest, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = request.body;
  if (!body) return null;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      // 宣言値が嘘だった場合に備え、実測でも打ち切る
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}
