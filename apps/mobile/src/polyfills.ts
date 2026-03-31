/**
 * WeakRef polyfill for Hermes (Android, old architecture).
 *
 * @react-navigation/core 7.17+ uses WeakRef to track consumed navigation params.
 * Hermes with newArchEnabled=false does not expose WeakRef as a JS global.
 *
 * This polyfill holds the reference strongly (no GC), which is safe for the
 * navigation use case: the object is small (route.params) and gets discarded
 * when the navigator unmounts anyway.
 */
if (typeof WeakRef === 'undefined') {
  // eslint-disable-next-line no-restricted-globals
  (global as unknown as Record<string, unknown>).WeakRef = class WeakRef<T extends object> {
    private _target: T;
    constructor(target: T) {
      this._target = target;
    }
    deref(): T {
      return this._target;
    }
  };
}
