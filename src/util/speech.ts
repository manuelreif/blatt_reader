export function canSpeak(): boolean {
  return typeof speechSynthesis !== 'undefined'
}

export function speak(text: string, lang = 'en-US') {
  if (!canSpeak()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith(lang.slice(0, 2)))
  if (voice) u.voice = voice
  u.rate = 0.95
  speechSynthesis.speak(u)
}
