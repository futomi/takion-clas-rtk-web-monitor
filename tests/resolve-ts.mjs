/**
 * Node の組み込みテストランナーで、拡張子を省略した相対 import を解決するためのフック。
 *
 * アプリ側のソースはバンドラ（Turbopack）解決を前提に `./foo` と書くため、
 * Node の ESM 解決（拡張子必須）とは相性が悪い。テスト実行時だけ `.ts` / `.tsx` を
 * 補って解決することで、テスト専用のビルド依存を増やさずに済ませている。
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx'];
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !HAS_EXTENSION.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of CANDIDATE_EXTENSIONS) {
        if (existsSync(fileURLToPath(new URL(base.href + extension)))) {
          return nextResolve(specifier + extension, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
