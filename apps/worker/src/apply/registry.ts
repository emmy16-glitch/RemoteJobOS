import type { ApplicationAdapter } from "./types.js";

export class AdapterRegistry {
  private readonly adapters: ApplicationAdapter[] = [];

  register(adapter: ApplicationAdapter): void {
    if (this.adapters.some((item) => item.name === adapter.name)) {
      throw new Error(`Adapter already registered: ${adapter.name}`);
    }
    this.adapters.push(adapter);
  }

  resolve(url: string): ApplicationAdapter | null {
    return this.adapters.find((adapter) => adapter.canHandle(url)) ?? null;
  }

  list(): string[] {
    return this.adapters.map((adapter) => adapter.name);
  }
}
