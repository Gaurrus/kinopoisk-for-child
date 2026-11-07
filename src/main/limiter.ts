import type { LimiterSnapshot } from '../shared/types';

export function normalizeLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(99, Math.max(0, Math.trunc(parsed)));
}

export interface AttemptOutcome {
  allowed: boolean;
  alreadyCounted: boolean;
}

export class EpisodeLimiter {
  private limit: number;
  private used = 0;
  private readonly allowed = new Set<string>();

  constructor(limit: unknown) {
    this.limit = normalizeLimit(limit);
  }

  attempt(key: string | null | undefined): AttemptOutcome {
    if (this.limit === 0) return { allowed: true, alreadyCounted: false };
    if (typeof key !== 'string' || key.length === 0) {
      return { allowed: true, alreadyCounted: false };
    }
    if (this.allowed.has(key)) return { allowed: true, alreadyCounted: true };
    if (this.used >= this.limit) return { allowed: false, alreadyCounted: false };

    this.allowed.add(key);
    this.used += 1;
    return { allowed: true, alreadyCounted: false };
  }

  setLimit(limit: unknown): void {
    this.limit = normalizeLimit(limit);
  }

  reset(limit: unknown = this.limit): void {
    this.limit = normalizeLimit(limit);
    this.used = 0;
    this.allowed.clear();
  }

  snapshot(): LimiterSnapshot {
    return {
      limit: this.limit,
      used: this.used,
      remaining: this.limit === 0 ? null : Math.max(0, this.limit - this.used),
      allowed: Array.from(this.allowed),
    };
  }
}
