import { GSA_ENTRY_TTL_MS, GSV_ENTRY_TTL_MS } from './constants';
import {
  type GnssSystemKey,
  type SatelliteBreakdown,
  getGnssSystemFromTalker,
  identifyGnssSystem,
} from './gnssSystem';
import type { GsaReport, GsvReport } from './types';

export type SatelliteSummary = {
  total: number;
  breakdown: SatelliteBreakdown;
};

type InViewEntry = { system: GnssSystemKey; updatedAt: number };
type UsedEntry = { systems: GnssSystemKey[]; prns: number[]; updatedAt: number };

const EMPTY_SUMMARY: SatelliteSummary = { total: 0, breakdown: {} };

/** 期限切れのエントリを取り除く */
function prune<T extends { updatedAt: number }>(entries: Map<string, T>, now: number, ttlMs: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.updatedAt > ttlMs) entries.delete(key);
  }
}

/**
 * GSV / GSA 電文から可視衛星・使用衛星をシステム別に集計する。
 *
 * どちらの電文もマルチ GNSS では系統ごとに複数行へ分割されて届くため、
 * 直近に届いた行をシステム単位で保持し、一定時間更新が無いものを失効させる。
 */
export class SatelliteTracker {
  /** 可視衛星: `${system}_${prn}` → 最終受信時刻。PRN が取れる受信機ではこちらを優先する */
  private readonly inViewByPrn = new Map<string, InViewEntry>();
  /** 可視衛星: talker → 申告された可視数。PRN が取れない場合のフォールバック */
  private readonly inViewByTalker = new Map<string, { count: number; updatedAt: number }>();
  /** 使用衛星: `${talker}_${systemId}` → その系統が測位に使っている PRN 群 */
  private readonly usedByGsa = new Map<string, UsedEntry>();

  reset(): void {
    this.inViewByPrn.clear();
    this.inViewByTalker.clear();
    this.usedByGsa.clear();
  }

  applyGsv(report: GsvReport, receivedAt: number): void {
    if (report.prns.length > 0) {
      for (const prn of report.prns) {
        const system = identifyGnssSystem(prn, report.talker);
        this.inViewByPrn.set(`${system}_${prn}`, { system, updatedAt: receivedAt });
      }
      return;
    }
    if (report.totalInView !== undefined) {
      this.inViewByTalker.set(report.talker, { count: report.totalInView, updatedAt: receivedAt });
    }
  }

  applyGsa(report: GsaReport, receivedAt: number): void {
    // PRN ごとの所属システムはこの時点で確定できるので、集計時の再計算を避けて保持する
    const systems = report.prns.map((prn) => identifyGnssSystem(prn, report.talker, report.systemId));
    this.usedByGsa.set(`${report.talker}_${report.systemId ?? 'default'}`, {
      systems,
      prns: report.prns,
      updatedAt: receivedAt,
    });
  }

  /** 可視衛星のシステム別内訳と総数を返す */
  inViewSummary(now: number): SatelliteSummary {
    prune(this.inViewByPrn, now, GSV_ENTRY_TTL_MS);

    if (this.inViewByPrn.size > 0) {
      const breakdown: SatelliteBreakdown = {};
      for (const entry of this.inViewByPrn.values()) {
        breakdown[entry.system] = (breakdown[entry.system] ?? 0) + 1;
      }
      return { total: this.inViewByPrn.size, breakdown };
    }

    prune(this.inViewByTalker, now, GSV_ENTRY_TTL_MS);
    const breakdown: SatelliteBreakdown = {};
    let total = 0;
    for (const [talker, entry] of this.inViewByTalker) {
      if (entry.count <= 0) continue;
      const system = getGnssSystemFromTalker(talker);
      breakdown[system] = (breakdown[system] ?? 0) + entry.count;
      total += entry.count;
    }
    return total > 0 ? { total, breakdown } : EMPTY_SUMMARY;
  }

  /** 測位に使用中の衛星のシステム別内訳と総数を返す。系統をまたぐ重複は排除する */
  usedSummary(now: number): SatelliteSummary {
    prune(this.usedByGsa, now, GSA_ENTRY_TTL_MS);

    const breakdown: SatelliteBreakdown = {};
    const seen = new Set<string>();
    for (const entry of this.usedByGsa.values()) {
      for (let index = 0; index < entry.prns.length; index += 1) {
        const system = entry.systems[index];
        const key = `${system}_${entry.prns[index]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        breakdown[system] = (breakdown[system] ?? 0) + 1;
      }
    }
    return { total: seen.size, breakdown };
  }
}
