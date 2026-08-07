// Makes `Buffer` available as a global in the bundled output so the plugin
// (and the megajs browser build) can use `Buffer` on both desktop (Electron)
// and mobile (browser webview, where Buffer is not global by default).
import { Buffer } from "buffer";
export { Buffer };