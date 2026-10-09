/** Mild pointer acceleration: slow drags stay precise, fast flicks cross the screen. */
export function accelerate(dx: number, dy: number, sensitivity = 1.4): [number, number] {
  const speed = Math.hypot(dx, dy);
  const gain = sensitivity * (1 + Math.min(speed / 30, 1.5));
  return [dx * gain, dy * gain];
}

/** Pixels of two-finger travel per wheel notch. */
export const SCROLL_PX_PER_NOTCH = 22;

export function scrollNotches(accumPx: number): { notches: number; rest: number } {
  const notches = Math.trunc(accumPx / SCROLL_PX_PER_NOTCH);
  return { notches, rest: accumPx - notches * SCROLL_PX_PER_NOTCH };
}
