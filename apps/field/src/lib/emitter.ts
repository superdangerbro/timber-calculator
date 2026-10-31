import { useSyncExternalStore } from 'react';

/** Minimal observable state container shared by the controllers and React. */
export class Emitter<S> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  getState = (): S => this.state;
  protected setState(patch: Partial<S>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  protected emit() {
    for (const l of [...this.listeners]) l();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export function useEmitter<S>(e: Emitter<S>): S {
  return useSyncExternalStore(e.subscribe, e.getState, e.getState);
}
