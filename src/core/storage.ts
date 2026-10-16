// Storage adapter: localStorage in the browser, memory in tests/bots.
export interface Storage {
  load<T>(key: string): T | null;
  save<T>(key: string, value: T): void;
}

export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  load<T>(key: string): T | null {
    const v = this.m.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  save<T>(key: string, value: T) {
    this.m.set(key, JSON.stringify(value));
  }
}

export class LocalStorage implements Storage {
  constructor(private prefix = "tlc.") {}
  load<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(this.prefix + key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }
  save<T>(key: string, value: T) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      /* private mode / quota: progress just won't persist */
    }
  }
}
