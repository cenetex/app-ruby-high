export interface LiveStreamPoolSnapshot {
  active: number;
  clients: number;
  limitPerClient: number;
  saturatedClients: number;
  maxClientStreams: number;
}

export class LiveStreamPool {
  private readonly streams = new Map<string, number>();
  private readonly normalizedLimitPerClient: number;

  constructor(limitPerClient: number) {
    const limit = Math.floor(Number(limitPerClient));
    this.normalizedLimitPerClient = Number.isFinite(limit) && limit > 0 ? limit : 1;
  }

  reserve(clientKey: string): (() => void) | null {
    const key = this.normalizeClientKey(clientKey);
    const active = this.streams.get(key) ?? 0;
    if (active >= this.normalizedLimitPerClient) return null;
    this.streams.set(key, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.streams.get(key) ?? 1) - 1;
      if (next <= 0) this.streams.delete(key);
      else this.streams.set(key, next);
    };
  }

  snapshot(): LiveStreamPoolSnapshot {
    const counts = Array.from(this.streams.values());
    return {
      active: counts.reduce((sum, count) => sum + Math.max(0, count), 0),
      clients: counts.length,
      limitPerClient: this.normalizedLimitPerClient,
      saturatedClients: counts.filter((count) => count >= this.normalizedLimitPerClient).length,
      maxClientStreams: counts.length > 0 ? Math.max(...counts) : 0,
    };
  }

  private normalizeClientKey(clientKey: string): string {
    const key = String(clientKey ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return "no-ip";
    return key.length > 160 ? key.slice(0, 160) : key;
  }
}
