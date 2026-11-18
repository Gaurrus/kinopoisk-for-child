import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldRestartFirstEpisode } = require('../dist/browser/guard-runtime.js');

const FILM = '48609c673b79f2e589e08b9cb9c4faf5';
const PLAYER = `https://hd.kinopoisk.ru/film/${FILM}?content_type=episode&content_id=ep-26`;
const SERIES = `https://hd.kinopoisk.ru/film/${FILM}`;

test('first episode of a session restarts from the beginning', () => {
  assert.equal(shouldRestartFirstEpisode(PLAYER, 240, 300, false), true);
  assert.equal(shouldRestartFirstEpisode(PLAYER, 0, 300, false), false);
});

test('only the first episode of the session is restarted', () => {
  assert.equal(shouldRestartFirstEpisode(PLAYER, 240, 300, true), false);
});

test('a series landing page and short clips are not restarted', () => {
  assert.equal(shouldRestartFirstEpisode(SERIES, 240, 300, false), false);
  assert.equal(shouldRestartFirstEpisode(PLAYER, 30, 30, false), false);
});
