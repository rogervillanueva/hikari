// Service Worker global scope types
declare global {
  interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
    skipWaiting(): Promise<void>;
    clients: Clients;
    registration: ServiceWorkerRegistration;
    addEventListener(type: 'install', listener: (event: ExtendableEvent) => void): void;
    addEventListener(type: 'activate', listener: (event: ExtendableEvent) => void): void;
    addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  }

  interface ExtendableEvent extends Event {
    waitUntil(promise: Promise<any>): void;
  }

  interface FetchEvent extends ExtendableEvent {
    request: Request;
    respondWith(promise: Promise<Response>): void;
  }

  interface Clients {
    claim(): Promise<void>;
  }
}

export {};