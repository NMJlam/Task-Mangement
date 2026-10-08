/// <reference types="vite/client" />

/**
 * The `VITE_*` variables the app reads. Declared so each is a `string`, not the
 * `any` that `vite/client`'s index signature would give it. Inlined at build
 * time — see docs/setup.md.
 */
interface ImportMetaEnv {
  /** Inbox poll interval in milliseconds. Unset or invalid → 1000. */
  readonly VITE_NOTIFICATION_POLL_MS?: string;
}
