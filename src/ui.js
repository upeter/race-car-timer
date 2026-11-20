export function formatTime(seconds) {
  if (seconds === null) return '–';
  const hundredths = Math.round(seconds * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = hundredths - minutes * 6000;
  const whole = String(Math.floor(rest / 100)).padStart(2, '0');
  const fraction = String(rest % 100).padStart(2, '0');
  return `${minutes}:${whole}.${fraction}`;
}

export function hueToCss(hue) {
  return `hsl(${Math.round(hue)} 90% 55%)`;
}

// Pointer position as fractions (0–1) of the element's box.
export function normalizedPoint(event, element) {
  const rect = element.getBoundingClientRect();
  const clamp = (value) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

// Browsers allow sound only after a user gesture: call unlock() from a
// click handler before the first beep().
export function createBeeper() {
  let context = null;
  return {
    unlock() {
      if (context === null) context = new AudioContext();
      if (context.state === 'suspended') context.resume();
    },
    beep(frequency = 880, duration = 0.12) {
      if (context === null) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.3;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    },
  };
}
