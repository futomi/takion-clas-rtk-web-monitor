import type { Metadata } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import './map.css';

/*
 * 和文書体。
 *
 * Fluent 2 の欧文は Segoe UI Variable だが、和文は「各言語の OS 標準 UI 書体」に
 * 委ねる方針のため公式の指定が無い。その OS 既定である Yu Gothic UI は本文用書体が
 * 出自で線が細く、実測すると 500/600/700 がいずれも合成太字の同じ太さに丸められる。
 * つまり weight ランプが regular と bold の 2 段に潰れ、medium と semibold が効かない。
 *
 * そこで和文だけ Noto Sans JP を可変フォントで配信し、400/500/600/700 の 4 段を
 * どの環境でも同じ見え方に揃える。next/font がビルド時に取得して
 * 自ドメインから配る（閲覧者から Google へのリクエストは発生しない）。
 * 日本語はサブセットが数百に分割されるため preload は行わず、
 * 未読込の間は base.css 側に並べた OS 書体で表示する。
 */
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-japanese',
});

export const metadata: Metadata = {
  title: 'Takion CLAS / RTK Web Monitor — 測位モニター',
  description: 'TakionCM001等のUSBシリアル出力をChromeで読み取り、みちびきCLAS測位およびネットワークRTK測位の情報とUBX・NMEA・RTCMログを表示するウェブアプリです。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" className={notoSansJP.variable}><body>{children}</body></html>;
}
