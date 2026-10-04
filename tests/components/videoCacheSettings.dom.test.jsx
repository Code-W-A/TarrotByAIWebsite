/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoCacheSettings from '../../components/Dashboard/VideoCacheSettings';

let container, root;
const state = { available: true, rowCount: 125, updatedAt: '2026-10-04T12:00:00Z', lastRebuild: { status: 'success' } };
const response = (body, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = jest.fn(async () => response(state));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete global.fetch; });

it('shows total/date/status and disables the rebuild button until the operation finishes', async () => {
  await act(async () => root.render(<VideoCacheSettings />));
  expect(container.textContent).toContain('125');
  expect(container.textContent).toContain('Reușită');
  expect(container.textContent).toContain('4.10.2026');
  let release;
  fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => container.querySelector('button').click());
  expect(container.querySelector('button').disabled).toBe(true);
  expect(container.textContent).toContain('Se reconstruiește');
  await act(async () => release(response({ ok: true, rowCount: 126 })));
  expect(container.querySelector('button').disabled).toBe(false);
  expect(container.querySelector('[role="status"]').textContent).toContain('126');
  expect(fetch.mock.calls[1][0]).toContain('/rebuild');
  expect(fetch.mock.calls[1][1].method).toBe('POST');
});

it('shows failed rebuild and permits retry without clearing the old total', async () => {
  await act(async () => root.render(<VideoCacheSettings />));
  fetch.mockImplementationOnce(async () => response({ error: 'Reconstruirea a eșuat.' }, false));
  await act(async () => container.querySelector('button').click());
  expect(container.querySelector('[role="alert"]').textContent).toContain('eșuat');
  expect(container.textContent).toContain('125');
  expect(container.querySelector('button').disabled).toBe(false);
});
