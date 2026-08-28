import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * 静的書き出しで配るかどうか。
 *
 * Node.js の動かないレンタルサーバー等へ、ファイルを置くだけで公開する場合に立てる。
 * このとき `/api/ntrip/*` は成果物に含まれない。中継はサーバーが要る機能なので、
 * どのみち提供できないうえ、`force-dynamic` なルートは書き出し自体を止めてしまう。
 * 除外は {@link pageExtensions} の切り替えで行う（ファイル名の `.server.ts` を
 * 認識するかどうかで、ルートとして拾うか否かが決まる）。
 */
const isStaticExport = process.env.STATIC_EXPORT === 'true';

/**
 * サブディレクトリ配下へ置く場合の接頭辞（例: `/rtk`）。ドメイン直下なら空のまま。
 *
 * 設定しないと CSS と JS の参照先がドメイン直下になり、すべて 404 になる。
 */
const basePath = process.env.BASE_PATH ?? '';

/** 地図タイルの配信元。ここ以外への外部通信は行わない */
const TILE_ORIGIN = 'https://tile.openstreetmap.org';

/**
 * Content-Security-Policy。
 *
 * このアプリが外部と通信するのは地図タイルの取得だけで、それ以外の宛先は自オリジンに閉じる。
 * `script-src` に `unsafe-inline` が要るのは、Next.js がハイドレーション用の
 * インラインスクリプトを埋め込むため。開発時は Turbopack の HMR が eval を使う。
 * `worker-src` の `blob:` は MapLibre GL がタイル描画用のワーカーを起こすのに要る。
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `img-src 'self' data: blob: ${TILE_ORIGIN}`,
  `connect-src 'self' ${TILE_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "font-src 'self' data:",
].join('; ');

/**
 * 全応答へ付ける防御的なヘッダ。
 *
 * Web Serial API は利用者の明示的な操作でしか開かないため `Permissions-Policy` では触れず、
 * このアプリが一切使わない機能だけを塞いでいる。
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: 'export' as const } : {}),
  ...(basePath ? { basePath } : {}),

  /*
   * API ルートのファイル名は `route.server.ts`。この拡張子を認識する設定のときだけ
   * ルートとして拾われるため、静的書き出しでは一覧から外して成果物へ含めない。
   */
  pageExtensions: isStaticExport ? ['tsx', 'ts'] : ['server.ts', 'tsx', 'ts'],

  /*
   * 静的書き出しでは Next がヘッダを付けられない（配信するのは Web サーバー）。
   * 同じ内容を `public/.htaccess` に置いてあるので、そちらを使う。
   * ここで宣言したままにすると、効かない設定に対する警告がビルドのたびに出る。
   */
  ...(isStaticExport
    ? {}
    : {
        async headers() {
          return [{ source: '/:path*', headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
