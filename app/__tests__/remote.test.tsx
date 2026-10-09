import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { DeltaBatcher } from '../src/features/remote/batcher';
import { accelerate, scrollNotches } from '../src/features/remote/pointer';
import { Remote } from '../src/features/remote/Remote';
import { TrackpadController } from '../src/features/remote/Trackpad';

describe('DeltaBatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('emits at most ~60 Hz and sums deltas', () => {
    const emit = jest.fn();
    const b = new DeltaBatcher(emit, 16);
    for (let i = 0; i < 100; i++) b.add(1, 2); // 100 touch events inside one frame
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(100, 200);
    // one second of continuous 240 Hz input -> no more than 63 emits
    emit.mockClear();
    for (let t = 0; t < 1000; t += 4) {
      b.add(1, 0);
      jest.advanceTimersByTime(4);
    }
    expect(emit.mock.calls.length).toBeLessThanOrEqual(63);
    expect(emit.mock.calls.reduce((s, c) => s + c[0], 0)).toBeGreaterThan(240);
    b.stop();
  });

  it('keeps sub-pixel remainders instead of losing them', () => {
    const emit = jest.fn();
    const b = new DeltaBatcher(emit, 16);
    b.add(0.4, 0);
    jest.advanceTimersByTime(16);
    expect(emit).not.toHaveBeenCalled();
    b.add(0.7, 0);
    jest.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledWith(1, 0);
    b.stop();
  });

  it('stops ticking when idle', () => {
    const emit = jest.fn();
    const b = new DeltaBatcher(emit, 16);
    b.add(5, 5);
    jest.advanceTimersByTime(100);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('pointer maths', () => {
  it('accelerates fast movement more than slow movement', () => {
    const [slow] = accelerate(2, 0);
    const [fast] = accelerate(40, 0);
    expect(fast / 40).toBeGreaterThan(slow / 2);
  });
  it('converts scroll distance into notches', () => {
    expect(scrollNotches(50)).toEqual({ notches: 2, rest: 6 });
    expect(scrollNotches(-50)).toEqual({ notches: -2, rest: -6 });
  });
});

describe('TrackpadController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('maps gestures to events', () => {
    const send = jest.fn();
    const c = new TrackpadController(send);
    c.click('left');
    c.click('right');
    expect(send).toHaveBeenNthCalledWith(1, { type: 'mouse_click', button: 'left', count: 1 });
    expect(send).toHaveBeenNthCalledWith(2, { type: 'mouse_click', button: 'right', count: 1 });
    send.mockClear();

    c.dragStart();
    c.move(10, 0);
    c.dragEnd(); // flushes the pending move before releasing
    expect(send.mock.calls.map((x) => x[0].type)).toEqual(['mouse_down', 'mouse_move', 'mouse_up']);
    send.mockClear();

    c.scroll(-50); // fingers moved up 50px
    jest.advanceTimersByTime(20);
    expect(send).toHaveBeenCalledWith({ type: 'scroll', dx: 0, dy: 2 });
    c.dispose();
  });
});

describe('Remote buttons', () => {
  it('slide buttons send the right keys', async () => {
    const send = jest.fn();
    await render(<Remote send={send} />);
    await fireEvent.press(screen.getByLabelText('Next'));
    await fireEvent.press(screen.getByLabelText('Previous'));
    await fireEvent.press(screen.getByLabelText('Start (F5)'));
    await fireEvent.press(screen.getByLabelText('Stop (Esc)'));
    await fireEvent.press(screen.getByLabelText('Page Down'));
    await fireEvent.press(screen.getByLabelText('Page Up'));
    expect(send.mock.calls.map((c) => c[0].key)).toEqual(['right', 'left', 'f5', 'escape', 'pagedown', 'pageup']);
  });

  it('media buttons send media actions', async () => {
    const send = jest.fn();
    await render(<Remote send={send} />);
    await fireEvent.press(screen.getByText('Media'));
    for (const l of ['Play / Pause', 'Next', 'Previous', 'Vol +', 'Mute']) await fireEvent.press(screen.getByLabelText(l));
    await fireEvent.press(screen.getByLabelText('Vol −'));
    expect(send.mock.calls.map((c) => c[0].action)).toEqual(['play_pause', 'next', 'previous', 'volume_up', 'mute', 'volume_down']);
  });

  it('keyboard sends text and special keys', async () => {
    const send = jest.fn();
    await render(<Remote send={send} />);
    await fireEvent.press(screen.getByText('Keys'));
    await fireEvent.changeText(screen.getByLabelText('Text to type on laptop'), 'hello');
    await fireEvent.press(screen.getByLabelText('Type on laptop'));
    await fireEvent.press(screen.getByLabelText('Backspace'));
    await fireEvent.press(screen.getByLabelText('Enter'));
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'key', key: 'backspace' },
      { type: 'key', key: 'enter' },
    ]);
  });

  it('does nothing while disabled (paused / offline)', async () => {
    const send = jest.fn();
    await render(<Remote send={send} disabled />);
    await fireEvent.press(screen.getByLabelText('Next'));
    expect(send).not.toHaveBeenCalled();
  });
});
