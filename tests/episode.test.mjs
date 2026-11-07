import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractContentId, parseSeasonEpisode, strongEpisodeKey } = require('../dist/shared/episode.js');

const FILM = '48609c673b79f2e589e08b9cb9c4faf5';

test('extractContentId reads kinopoisk film ids', () => {
  assert.equal(extractContentId(`https://hd.kinopoisk.ru/film/${FILM}`), FILM);
  assert.equal(extractContentId(`https://hd.kinopoisk.ru/film/${FILM}/season-1/episode-2`), FILM);
  assert.equal(extractContentId('https://hd.kinopoisk.ru/'), null);
});

test('parseSeasonEpisode understands path-like strings', () => {
  assert.deepEqual(parseSeasonEpisode('/season-1/episode-2'), { season: 1, episode: 2 });
  assert.deepEqual(parseSeasonEpisode('/film/x/s1/e3'), { season: 1, episode: 3 });
  assert.deepEqual(parseSeasonEpisode('?season=2&episode=5'), { season: 2, episode: 5 });
});

test('parseSeasonEpisode understands human labels', () => {
  assert.deepEqual(parseSeasonEpisode('Сезон 1, серия 5'), { season: 1, episode: 5 });
  assert.deepEqual(parseSeasonEpisode('S1 E5'), { season: 1, episode: 5 });
  assert.deepEqual(parseSeasonEpisode('Серия 7'), { season: null, episode: 7 });
  assert.deepEqual(parseSeasonEpisode('Три кота'), { season: null, episode: null });
});

test('strongEpisodeKey extracts explicit episode from path', () => {
  assert.equal(
    strongEpisodeKey(`https://hd.kinopoisk.ru/film/${FILM}/season-1/episode-2`),
    `ep:${FILM}:s1:e2`,
  );
  assert.equal(strongEpisodeKey(`https://hd.kinopoisk.ru/film/${FILM}/s2/e7`), `ep:${FILM}:s2:e7`);
});

test('strongEpisodeKey extracts episode id from query', () => {
  assert.equal(
    strongEpisodeKey(`https://hd.kinopoisk.ru/film/${FILM}?content_type=episode&content_id=abc-123`),
    'ep:abc-123',
  );
  assert.equal(
    strongEpisodeKey(`https://hd.kinopoisk.ru/film/${FILM}?season=2&episode=5`),
    `ep:${FILM}:s2:e5`,
  );
});

test('strongEpisodeKey stays null for a movie page', () => {
  assert.equal(strongEpisodeKey(`https://hd.kinopoisk.ru/film/${FILM}`), null);
  assert.equal(strongEpisodeKey('https://hd.kinopoisk.ru/'), null);
});
