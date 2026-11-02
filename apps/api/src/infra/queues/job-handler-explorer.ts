import { Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { JOB_HANDLER_METADATA, type JobHandlerMetadata } from './job-handler.js';
import { type RegisteredJobHandler, toJobRun } from './queue-workers.js';

/** Metoda providera oznaczona dekoratorem. */
export interface DiscoveredMethod<TMetadata> {
  readonly metadata: TMetadata;
  /** Klasa.metoda, do komunikatów. */
  readonly source: string;
  readonly invoke: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Znajduje w providerach wszystkich modułów metody oznaczone dekoratorami jobów i eventów.
 * Działa tylko w procesie workera (wymaga DiscoveryModule). Pomija providery o zasięgu żądania
 * i transient: handler jobu musi być singletonem.
 */
@Injectable()
export class JobHandlerExplorer {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  /** Metody z metadanymi pod kluczem `metadataKey` (np. z SetMetadata w dekoratorze). */
  methods<TMetadata>(metadataKey: string): DiscoveredMethod<TMetadata>[] {
    const found: DiscoveredMethod<TMetadata>[] = [];
    const seen = new Set<object>();
    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.isDependencyTreeStatic() || wrapper.isTransient) {
        continue;
      }
      const instance: unknown = wrapper.instance;
      if (instance === null || typeof instance !== 'object' || seen.has(instance)) {
        continue;
      }
      seen.add(instance);
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown> | null;
      if (prototype === null) {
        continue;
      }
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = prototype[methodName];
        if (typeof method !== 'function') {
          continue;
        }
        const metadata = this.reflector.get<TMetadata | undefined>(metadataKey, method);
        if (metadata === undefined) {
          continue;
        }
        const handler = method as (...params: unknown[]) => unknown;
        found.push({
          metadata,
          source: `${instance.constructor.name}.${methodName}`,
          // Synchroniczny wyjątek handlera też ma być odrzuconą obietnicą.
          invoke: async (...args: unknown[]): Promise<unknown> =>
            await Promise.resolve(handler.apply(instance, args)),
        });
      }
    }
    return found;
  }

  /** Handlery z @JobHandler i @ScheduledJob. */
  jobHandlers(): RegisteredJobHandler[] {
    return this.methods<JobHandlerMetadata>(JOB_HANDLER_METADATA).map(
      ({ metadata, source, invoke }) => ({
        queue: metadata.queue,
        name: metadata.name,
        ...(metadata.schedule === undefined ? {} : { schedule: metadata.schedule }),
        source,
        handle: (job) => invoke(toJobRun(metadata.queue, job)),
      }),
    );
  }
}
