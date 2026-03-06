import assert from 'node:assert/strict';
import test from 'node:test';

const ptyModuleUrl = new URL('../runner/dist/pty.js', import.meta.url);
const {
  encodeTmuxHexArgs,
  renderCapturedPaneDelta,
} = await import(ptyModuleUrl);

test('runner pty encodes terminal input bytes into tmux hex arguments', () => {
  const bytes = Buffer.from([0x1b, 0x5b, 0x41, 0x0d, 0x7f]);
  assert.deepEqual(encodeTmuxHexArgs(bytes), ['1b', '5b', '41', '0d', '7f']);
});

test('runner pty emits append-only delta when pane capture only grows', () => {
  const previous = 'hello\n';
  const next = 'hello\nworld';
  assert.equal(renderCapturedPaneDelta(previous, next), 'world');
});

test('runner pty forces redraw when pane capture changes in-place', () => {
  const previous = 'ready\n';
  const next = 'busy\n';
  const delta = renderCapturedPaneDelta(previous, next);
  assert.match(delta, /^\u001b\[2J\u001b\[H/);
  assert.match(delta, /busy/);
});
