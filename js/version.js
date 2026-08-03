// Bump this on every meaningful feature release (never overwrite a prior
// version's number — always increment). Shown in the page title and footer
// so it's obvious which build is running, especially useful since this app
// is redeployed straight to GitHub Pages rather than distributed as builds.
export const APP_VERSION = "2.10.1";
export const APP_VERSION_LABEL = `Comic Studio v${APP_VERSION}`;
export const APP_VERSION_NOTES = "Corretto un falso \"✅ Compatibile\" nella scheda Modelli: i file .gguf non vengono più proposti sotto nodi che non li supportano (es. UNETLoader), evitando l'errore ComfyUI \"value not in list\".";
