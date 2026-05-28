/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<{}, {}, unknown>;
  export default c;
}
