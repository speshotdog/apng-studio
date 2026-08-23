import type { Api } from '../preload/api.js'
declare global {
  interface Window {
    api: Api
  }
  interface ImportMetaEnv {
    readonly DEV: boolean
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}
declare module '*.css'
export {}
