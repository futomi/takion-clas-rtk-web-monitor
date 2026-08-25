/** 2 つのバイト列を連結した新しい配列を返す */
export function concatBytes(head: Uint8Array, tail: Uint8Array): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(head.length + tail.length);
  merged.set(head);
  merged.set(tail, head.length);
  return merged;
}
