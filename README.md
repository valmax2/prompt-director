# Prompt Director — ComfyUI Comic/Scene Creator

Applicazione web statica (HTML/CSS/JS vanilla, nessuna build richiesta) per creare
fumetti generando le immagini (o animazioni/video) tramite una istanza locale di
[ComfyUI](https://github.com/comfyanonymous/ComfyUI).

Repository dedicato: il codice vive direttamente nella root di questo repo
(nessuna sottocartella). L'interfaccia mostra ancora "Comic Studio" come nome
del prodotto — è lo stesso progetto.

**Versione corrente: v2.0.0** (vedi `js/version.js`, mostrata anche nel footer
dell'app). Novità principali di questa versione: sistema "Personaggio
Coerente" (riferimenti identità/personaggio/posa indipendenti + blocco di
coerenza automatico nel prompt), supporto ai workflow di animazione/video
(rilevamento output video, frame count/FPS regolabili), formato immagine e
tag di qualità selezionabili.

## Moduli

- **Modalità di generazione** — selettore in alto: **ComfyUI locale** o **IA
  Esterna**. Pensato per usare l'app anche da telefono, fuori casa: costruisci
  scena, personaggio, camera e luci e genera con un'IA cloud, poi rifinisci in
  locale su ComfyUI quando torni a casa.
- **Connessione ComfyUI** — configura protocollo/IP/porta/credenziali della tua
  istanza ComfyUI locale, con test di connessione (`/system_stats`). I dati
  restano solo in `localStorage` del browser.
- **IA Esterne** — chiavi API per Google Gemini, OpenAI (ChatGPT/DALL·E) e
  Leonardo.ai, con selezione del provider attivo. Le chiamate partono
  direttamente dal browser verso l'API ufficiale del provider scelto; le
  chiavi restano solo in `localStorage`. Gemini e OpenAI supportano
  l'immagine di riferimento del personaggio, Leonardo.ai per ora solo
  testo → immagine. Meta AI non è incluso: non ha un'API pubblica per
  generazione immagini richiamabile da terze parti.
- **Workflow** — carica uno o più workflow ComfyUI esportati in *formato API*
  (Menu ComfyUI → "Save (API Format)"), selezionane uno come attivo e mappa
  quali nodi ricevono: prompt positivo/negativo (uno o più nodi, campo libero
  — es. `text` o `prompt` per nodi come TextEncodeQwenImageEdit/Plus), seed,
  risoluzione (larghezza/altezza), numero di frame e FPS (workflow di
  animazione), e le immagini di riferimento. Ogni nodo immagine può avere una
  **sorgente** indipendente — Personaggio (corpo/costume), Identità (volto) o
  Posa (opzionale, solo posa/composizione) — e un'etichetta, per combinare più
  personaggi e più tipi di riferimento nello stesso invio.
- **Personaggi** — il tuo archivio personaggi: carica immagini dalla galleria
  o scattale direttamente con la fotocamera del telefono, rinominale ed
  eliminale. Ogni personaggio può avere anche una foto di **identità** (volto)
  separata dalla foto principale (corpo/costume), usata dal sistema
  "Personaggio Coerente". Sono riutilizzabili come immagine di riferimento
  nella generazione per mantenere lo stesso aspetto del personaggio. Ogni
  miniatura ha un'icona 👁️ per nasconderla/sfocarla (privacy sullo schermo).
- **Crea Scena** — il flusso principale, tutto su una sola schermata in
  passaggi numerati, senza dover saltare tra schede:
  1. **Personaggio** — un selettore indipendente per ogni immagine mappata nel
     workflow attivo (identità/personaggio/posa, anche per più personaggi
     diversi insieme); la posa è un caricamento a parte, opzionale, non legato
     a un personaggio salvato. Attivando "Personaggio Coerente" si aggiunge
     automaticamente al prompt un blocco che indica all'IA cosa preservare
     (identità, lineamenti, costume, colori...) e cosa può cambiare
     liberamente (scena, azione, luce), con 6 controlli di forza/coerenza e
     preset di posa (ritratto, azione, combattimento, ecc.). Un riepilogo
     mostra sorgente/nodo/campo/file assegnato prima dell'invio.
  2. **Scena** — scrivi la descrizione in italiano (anche a voce, con il
     pulsante microfono 🎤), stile, formato immagine (1:1/16:9/9:16/...), tag
     di qualità (fotorealistico, cinematografico, 8K...), numero di
     frame/FPS per workflow di animazione, e negativi extra.
  3. **Regia (camera)** — tre diagrammi trascinabili (non usa la fotocamera
     del telefono): vista dall'alto (davanti/lato/dietro + zoom, trascinando
     la 📷 anche più vicina/lontana dal personaggio), vista laterale (altezza
     camera), e zoom/inquadratura con anteprima live (una linea trascinabile
     su una sagoma mostra esattamente cosa resta dentro/fuori, dal viso alla
     figura intera) — sincronizzata con lo zoom del primo diagramma. Un
     riquadro "Anteprima scena" riepiloga sempre in italiano cosa hai
     impostato. "Applica alla scena" la aggiunge al prompt.
  4. **Traduci** — traduce e ottimizza in inglese (tag comma-separated +
     booster di qualità); include sempre un prompt negativo anatomico di
     base. Copia rapida degli output con un pulsante dedicato.
  5. **Genera** — invia a ComfyUI o all'IA esterna scelta (in alto), con
     link diretto all'Archivio a fine generazione.

  Tutto (testo, stile, personaggio, impostazioni di regia) resta salvato
  anche cambiando scheda o chiudendo il browser, e il prompt si aggiorna da
  solo se modifichi la regia dopo aver tradotto. Se preferisci generare a
  mano su ChatGPT/Gemini (es. con un abbonamento Plus) c'è un pulsante che
  copia il prompt e apre direttamente il sito dell'IA scelta; l'immagine del
  personaggio si copia a parte dalla scheda Personaggi.
- **Archivio** — galleria delle immagini (o video/animazioni, riconosciuti
  automaticamente e mostrati con player) generate, con icona 👁️ per
  nascondere/sfocare una miniatura (privacy) e toggle "Attiva" per includerla
  nel progetto corrente; download e cancellazione.

## Uso

Serve semplicemente da servire come sito statico, es.:

```bash
python3 -m http.server 8000
```

poi apri `http://localhost:8000`. Le immagini/workflow/personaggi vengono
salvati in IndexedDB nel browser; nulla viene inviato altrove tranne le
chiamate esplicite verso l'istanza ComfyUI configurata, verso il provider IA
esterno scelto (se in modalità "IA Esterna") e (per la traduzione) verso
l'API pubblica MyMemory.

### Uso da telefono / fuori casa (GitHub Pages)

Il repository include `.github/workflows/deploy_pages.yml`, che pubblica
automaticamente questo repository su GitHub Pages a ogni push su `main`. Per
attivarlo (una tantum, da fare manualmente su github.com, richiede permessi
di amministrazione sul repository):

1. Settings → Pages → "Build and deployment" → Source = **GitHub Actions**.
2. Al successivo push il workflow pubblica il sito su
   `https://<utente>.github.io/<repo>/`.

Il repository è pubblico: il codice è visibile a chiunque abbia il link, ma
nessun dato personale ci finisce dentro — foto, personaggi, workflow e chiavi
API restano sempre solo nel browser di chi usa l'app (IndexedDB/localStorage),
mai su GitHub.

In modalità "IA Esterna" da remoto funziona tutto (le chiamate vanno dirette
al provider cloud); la modalità "ComfyUI locale" richiede invece che il
telefono/browser possa raggiungere l'IP del PC con ComfyUI in esecuzione
(stessa rete locale, oppure VPN/tunnel).

## Note tecniche

- Nessuna dipendenza esterna: solo ES modules nativi del browser.
- Persistenza locale: IndexedDB per workflow/personaggi/immagini,
  `localStorage` per le impostazioni di connessione e le chiavi dei provider
  IA esterni.
- La comunicazione con ComfyUI usa le API REST standard: `/system_stats`,
  `/upload/image`, `/prompt`, `/history/{id}`, `/view`.
- Provider esterni: Gemini (`generativelanguage.googleapis.com`), OpenAI
  (`api.openai.com/v1/images/...`), Leonardo.ai
  (`cloud.leonardo.ai/api/rest/v1/generations`).
