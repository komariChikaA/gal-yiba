/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_STATIC_PLAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
