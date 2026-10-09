import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { tap } from '../../components/ui';
import { colors } from '../../theme';
import { DeltaBatcher } from './batcher';
import { accelerate, scrollNotches } from './pointer';

type Send = (ev: object) => unknown;

/** Turns gesture callbacks into remote-control events. Plain class so it can be unit tested. */
export class TrackpadController {
  private send: Send;
  private scrollAccum = 0;
  private moves: DeltaBatcher;
  private scrolls: DeltaBatcher;

  constructor(send: Send) {
    this.send = send;
    this.moves = new DeltaBatcher((dx, dy) => this.send({ type: 'mouse_move', dx, dy }));
    this.scrolls = new DeltaBatcher((_dx, dy) => this.send({ type: 'scroll', dx: 0, dy }));
  }

  setSend(send: Send) {
    this.send = send;
  }

  dispose() {
    this.moves.stop();
    this.scrolls.stop();
  }

  move = (changeX: number, changeY: number) => {
    const [dx, dy] = accelerate(changeX, changeY);
    this.moves.add(dx, dy);
  };

  dragStart = () => {
    tap('heavy');
    this.moves.flush();
    this.send({ type: 'mouse_down', button: 'left' });
  };

  dragEnd = () => {
    this.moves.flush();
    this.send({ type: 'mouse_up', button: 'left' });
  };

  scroll = (changeY: number) => {
    // dragging fingers up scrolls the page down, like on the phone itself
    this.scrollAccum += -changeY;
    const { notches, rest } = scrollNotches(this.scrollAccum);
    this.scrollAccum = rest;
    if (notches) this.scrolls.add(0, notches);
  };

  click = (button: 'left' | 'right') => {
    tap(button === 'left' ? 'light' : 'medium');
    this.send({ type: 'mouse_click', button, count: 1 });
  };
}

/**
 * One finger drag = move, tap = left click, two-finger tap = right click,
 * two-finger drag = scroll, long-press then drag = press-and-hold (drag & drop).
 */
export function Trackpad({ send, disabled }: { send: Send; disabled?: boolean }) {
  const [ctl] = useState(() => new TrackpadController(send));
  useEffect(() => {
    ctl.setSend(send);
  }, [ctl, send]);
  useEffect(() => () => ctl.dispose(), [ctl]);

  const [gesture] = useState(() => {
    const move = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(3)
      .onChange((e) => ctl.move(e.changeX, e.changeY));

    const drag = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .activateAfterLongPress(350)
      .onStart(() => ctl.dragStart())
      .onChange((e) => ctl.move(e.changeX, e.changeY))
      .onFinalize((_e, success) => {
        if (success) ctl.dragEnd();
      });

    const scroll = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .maxPointers(2)
      .onChange((e) => ctl.scroll(e.changeY));

    const leftClick = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(250)
      .onEnd((_e, ok) => {
        if (ok) ctl.click('left');
      });

    const rightClick = Gesture.Tap()
      .runOnJS(true)
      .minPointers(2)
      .maxDuration(300)
      .onEnd((_e, ok) => {
        if (ok) ctl.click('right');
      });

    return Gesture.Race(rightClick, scroll, drag, move, leftClick);
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.pad, disabled && { opacity: 0.4 }]} accessibilityLabel="Trackpad" pointerEvents={disabled ? 'none' : 'auto'}>
        <Text style={styles.hint}>Drag to move{'\n'}Tap = click · Two-finger tap = right click{'\n'}Two-finger drag = scroll · Hold then drag = drag & drop</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pad: {
    flex: 1,
    minHeight: 240,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  hint: { color: colors.muted, textAlign: 'center', lineHeight: 22 },
});
