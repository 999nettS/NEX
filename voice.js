// voice.js — thin wrapper around the Web Speech APIs.
// Important reality check baked in here: iOS Safari has never shipped
// window.SpeechRecognition / webkitSpeechRecognition. On iOS the mic
// button degrades to "use the keyboard's built-in dictation" rather than
// silently failing or pretending to listen.

function detectRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor || null;
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export const Voice = {
  recognitionSupported: !!detectRecognition(),
  synthesisSupported: "speechSynthesis" in window,
  isIOS: isIOS(),

  startDictation(onResult, onError) {
    const Ctor = detectRecognition();
    if (!Ctor) {
      onError(
        this.isIOS
          ? "Live dictation isn't available in Safari on iOS. Tap the microphone key on the keyboard instead — it dictates directly into the message box."
          : "Speech recognition isn't supported in this browser."
      );
      return null;
    }
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => onResult(e.results[0][0].transcript);
    recognition.onerror = (e) => onError(`Dictation error: ${e.error}`);
    recognition.start();
    return recognition;
  },

  speak(text) {
    if (!this.synthesisSupported || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utter);
  },

  stopSpeaking() {
    if (this.synthesisSupported) window.speechSynthesis.cancel();
  },
};
