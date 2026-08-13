import { HttpAgent } from '@ag-ui/client'

/**
 * Direct AG-UI connection to the Java Spring Boot gateway — no Node Runtime.
 *
 * same-origin URL: in dev the Vite proxy forwards /agui-api/* to
 * http://127.0.0.1:8090/*, in production nginx does the same.
 * No API keys in the browser; the gateway owns all downstream credentials.
 */
export const dataAgent = new HttpAgent({
  url: '/agui-api/opencode/ag-ui',
})
