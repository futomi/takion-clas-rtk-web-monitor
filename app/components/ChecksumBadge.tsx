/** チェックサム検証結果ごとの表示内容。`tone` は CSS クラス名にそのまま使う */
const CHECKSUM_STATES = {
  ok: {
    tone: 'ok',
    label: 'OK',
    title: 'チェックサム検証に成功しました',
  },
  bad: {
    tone: 'bad',
    label: 'ERR',
    title: 'チェックサムが一致しません（伝送エラーの可能性）',
  },
  notApplicable: {
    tone: '',
    label: '—',
    title: 'この電文はチェックサム検証の対象外です',
  },
} as const;

/** チェックサム検証結果のバッジ。3 つのログ表示モードで共通に使う */
export default function ChecksumBadge({ valid }: { valid: boolean | null }) {
  const state = valid === null
    ? CHECKSUM_STATES.notApplicable
    : valid ? CHECKSUM_STATES.ok : CHECKSUM_STATES.bad;
  return <span className={`checksum ${state.tone}`} title={state.title}>{state.label}</span>;
}
