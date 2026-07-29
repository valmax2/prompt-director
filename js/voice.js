import { qs, toast } from "./utils.js";

// Voice dictation for text fields using the browser's Web Speech API
// (SpeechRecognition). Supported on Chrome/Android; falls back to a
// disabled button with an explanatory tooltip where unavailable (e.g. most
// desktop Safari/Firefox).
//
// Deliberately NOT using continuous=true: on Android Chrome that mode is
// known to redeliver/duplicate the same finalized phrase multiple times.
// Instead each utterance runs as its own single-shot recognition session,
// committed to the text exactly once, and a new session is started
// automatically on "end" for as long as the user hasn't pressed stop —
// same experience for the user, without the duplication bug.

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export function initVoiceDictation(textareaId, buttonId, lang = "it-IT") {
  const button = qs(`#${buttonId}`);
  const textarea = qs(`#${textareaId}`);
  if (!button || !textarea) return;

  if (!SpeechRecognitionImpl) {
    button.disabled = true;
    button.title = "Dettatura vocale non supportata da questo browser";
    return;
  }

  let wantsListening = false;
  let currentRecognition = null;
  let baseText = "";

  function setListeningUI(isListening) {
    button.classList.toggle("listening", isListening);
    button.textContent = isListening ? "⏹️" : "🎤";
    button.title = isListening ? "Ferma dettatura" : "Detta a voce";
  }

  function startSession() {
    const recognition = new SpeechRecognitionImpl();
    currentRecognition = recognition;
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.addEventListener("result", (evt) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < evt.results.length; i++) {
        const transcript = evt.results[i][0].transcript;
        if (evt.results[i].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      if (finalTranscript) baseText = `${baseText} ${finalTranscript}`.trim();
      textarea.value = `${baseText} ${interimTranscript}`.trim();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    recognition.addEventListener("end", () => {
      if (wantsListening) {
        try {
          startSession();
        } catch {
          wantsListening = false;
          setListeningUI(false);
        }
      } else {
        setListeningUI(false);
      }
    });

    recognition.addEventListener("error", (evt) => {
      // "no-speech" just means silence was detected; "end" still fires right
      // after and will restart the session automatically while listening.
      if (evt.error === "no-speech" || evt.error === "aborted") return;
      wantsListening = false;
      toast(`Errore dettatura vocale: ${evt.error}`, "error");
    });

    recognition.start();
  }

  button.addEventListener("click", () => {
    if (wantsListening) {
      wantsListening = false;
      currentRecognition?.stop();
      setListeningUI(false);
      return;
    }
    baseText = textarea.value;
    wantsListening = true;
    try {
      startSession();
      setListeningUI(true);
    } catch (err) {
      wantsListening = false;
      setListeningUI(false);
      toast(`Impossibile avviare la dettatura: ${err.message}`, "error");
    }
  });
}
