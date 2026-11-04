/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Hls from 'hls.js';
import BunnyHlsPlayer from '../../components/VideoLibrary/BunnyHlsPlayer';

jest.mock('hls.js', () => {
  class MockHls {
    static Events = { ERROR: 'error', SUBTITLE_TRACKS_UPDATED: 'tracks', SUBTITLE_TRACK_SWITCH: 'switch' };
    static isSupported = jest.fn(() => true);
    static instances = [];
    handlers = {};
    subtitleTrack = -1;
    loadSource = jest.fn();
    attachMedia = jest.fn();
    destroy = jest.fn();
    constructor() { MockHls.instances.push(this); }
    on(event, fn) { this.handlers[event] = fn; }
    emit(event, data) { this.handlers[event]?.(event, data); }
  }
  return MockHls;
});

let root, container, nativeTracks;
const render = async (props = {}) => {
  await act(async () => root.render(<BunnyHlsPlayer src="/subtitles.m3u8" fallbackSrc="/base.m3u8" {...props} />));
};
const emit = async (event, data) => { await act(async () => Hls.instances.at(-1).emit(event, data)); };
const choose = async value => {
  await act(async () => {
    const select = container.querySelector('select');
    select.value = String(value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Hls.instances = [];
  Hls.isSupported.mockReturnValue(true);
  nativeTracks = Object.assign(new EventTarget(), { length: 0 });
  jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'textTracks', 'get').mockImplementation(() => nativeTracks);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

it('offers discovered HLS languages, starts Off and enables/disables the selected track', async () => {
  await render();
  expect(container.querySelector('select')).toBeNull();
  await emit('tracks', { subtitleTracks: [{ name: 'English', lang: 'en' }, { name: 'Français', lang: 'fr' }] });
  expect(container.querySelector('select').getAttribute('aria-label')).toBe('Subtitrări');
  expect(container.querySelector('select').value).toBe('-1');
  await choose(1);
  expect(Hls.instances[0].subtitleTrack).toBe(1);
  await emit('switch', { id: 0 });
  expect(container.querySelector('select').value).toBe('0');
  await choose(-1);
  expect(Hls.instances[0].subtitleTrack).toBe(-1);
});

it('keeps playback and selection when parent callbacks change', async () => {
  await render({ onError: () => {} });
  await emit('tracks', { subtitleTracks: [{ name: 'English' }] });
  await choose(0);
  await render({ onError: () => {}, onReady: () => {} });
  expect(Hls.instances).toHaveLength(1);
  expect(Hls.instances[0].destroy).not.toHaveBeenCalled();
  expect(container.querySelector('select').value).toBe('0');
});

it('uses hls.js even if Chrome advertises native HLS without subtitle tracks', async () => {
  HTMLMediaElement.prototype.canPlayType.mockReturnValue('maybe');
  await render();
  expect(Hls.instances).toHaveLength(1);
  await emit('tracks', { subtitleTracks: [{ name: 'English' }] });
  expect(container.querySelector('select')).not.toBeNull();
});

it('disables a failing subtitle without restarting the video', async () => {
  const unavailable = jest.fn();
  await render({ onSubtitlesUnavailable: unavailable });
  await emit('tracks', { subtitleTracks: [{ name: 'English' }] });
  await choose(0);
  await emit('error', { fatal: false, details: 'subtitleTrackLoadError' });
  expect(unavailable).toHaveBeenCalledWith(true);
  expect(container.querySelector('select').value).toBe('-1');
  expect(Hls.instances).toHaveLength(1);
});

it('falls back once, preserves position and does not repeat an earlier chapter seek', async () => {
  const unavailable = jest.fn(), onError = jest.fn();
  await render({ onSubtitlesUnavailable: unavailable, onError, seekRequest: { seconds: 12 } });
  const video = container.querySelector('video');
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
  expect(video.currentTime).toBe(12);
  video.currentTime = 47;
  await emit('error', { fatal: true, details: 'manifestLoadError' });
  expect(Hls.instances).toHaveLength(2);
  expect(Hls.instances[0].destroy).toHaveBeenCalled();
  expect(Hls.instances[1].loadSource).toHaveBeenCalledWith('/base.m3u8');
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
  expect(video.currentTime).toBe(47);
  expect(unavailable).toHaveBeenCalledWith(true);
  await emit('error', { fatal: true, details: 'manifestLoadError' });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(Hls.instances).toHaveLength(2);
});

it('supports Safari text tracks, native controls changes and Off', async () => {
  Hls.isSupported.mockReturnValue(false);
  HTMLMediaElement.prototype.canPlayType.mockReturnValue('maybe');
  await render();
  const english = { kind: 'subtitles', label: 'English', language: 'en', mode: 'showing' };
  nativeTracks[0] = english;
  nativeTracks.length = 1;
  await act(async () => {
    const event = new Event('addtrack');
    event.track = english;
    nativeTracks.dispatchEvent(event);
  });
  expect(english.mode).toBe('disabled');
  expect(container.querySelector('select').value).toBe('-1');
  await choose(0);
  expect(english.mode).toBe('showing');
  english.mode = 'disabled';
  await act(async () => nativeTracks.dispatchEvent(new Event('change')));
  expect(container.querySelector('select').value).toBe('-1');
  expect(Hls.instances).toHaveLength(0);
});

it('clears old language selection when switching to a different video source', async () => {
  await render();
  await emit('tracks', { subtitleTracks: [{ name: 'English' }] });
  await choose(0);
  await render({ src: '/different.m3u8' });
  expect(container.querySelector('select')).toBeNull();
  await emit('tracks', { subtitleTracks: [{ name: 'Deutsch' }] });
  expect(container.querySelector('select').value).toBe('-1');
});
