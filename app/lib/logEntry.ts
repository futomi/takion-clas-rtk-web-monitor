import { UBX_FRAME_OVERHEAD } from './ubx';
import { RTCM_FRAME_OVERHEAD } from './rtcm';
import { getMessageDefinition } from './messageDictionary';
import type { LogLine, ParsedMessage } from './types';

/** ログ行の連番を発番するカウンタ */
export function createLogIdGenerator(): () => number {
  let nextId = 0;
  return () => nextId++;
}

/**
 * 解析済み電文から表示用のログ行を組み立てる。
 *
 * NMEA / UBX / RTCM のいずれも同じ形に正規化するため、生成箇所はここ 1 つに集約する。
 * `meaning` は電文固有の要約を優先し、無ければ辞書の一般的な説明にフォールバックする。
 */
export function createLogEntry(
  parsed: ParsedMessage,
  rawText: string,
  receivedAt: number,
  id: number,
): LogLine {
  const definition = getMessageDefinition(parsed.type);
  return {
    id,
    receivedAt,
    rawText,
    type: parsed.type,
    valid: parsed.valid,
    titleJa: definition.titleJa,
    category: definition.category,
    categoryJa: definition.categoryJa,
    meaning: parsed.summary || definition.summary,
  };
}

/** UBX フレームのログ行を作る。バイナリなのでフレーム要約を生テキストの代わりに表示する */
export function createUbxLogEntry(parsed: ParsedMessage, frameLength: number, receivedAt: number, id: number): LogLine {
  const rawText = parsed.summary ?? `UBX-${parsed.type} · ${frameLength - UBX_FRAME_OVERHEAD} byte payload`;
  return createLogEntry(parsed, rawText, receivedAt, id);
}

/** RTCM フレームのログ行を作る */
export function createRtcmLogEntry(parsed: ParsedMessage, frameLength: number, receivedAt: number, id: number): LogLine {
  const rawText = parsed.summary ?? `RTCM3 frame · ${frameLength - RTCM_FRAME_OVERHEAD} byte payload`;
  return createLogEntry(parsed, rawText, receivedAt, id);
}
