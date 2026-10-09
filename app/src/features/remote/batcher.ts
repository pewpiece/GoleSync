/** Sums deltas and emits at most once per `intervalMs` (default ~60 Hz). Sub-pixel remainders carry over. */
export class DeltaBatcher {
  private dx = 0;
  private dy = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private emit: (dx: number, dy: number) => void,
    private intervalMs = 16,
  ) {}

  add(dx: number, dy: number) {
    this.dx += dx;
    this.dy += dy;
    if (!this.timer) this.timer = setInterval(() => this.flush(), this.intervalMs);
  }

  flush() {
    const x = Math.trunc(this.dx);
    const y = Math.trunc(this.dy);
    if (x !== 0 || y !== 0) {
      this.dx -= x;
      this.dy -= y;
      this.emit(x, y);
    } else if (this.timer) {
      clearInterval(this.timer); // idle: stop ticking until the next add()
      this.timer = null;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dx = this.dy = 0;
  }
}
