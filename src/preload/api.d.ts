import type { Api } from './api.js'
declare global {
  interface Window {
    api: Api
  }
}
export {}
