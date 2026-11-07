export interface SeasonEpisode {
  season: number | null;
  episode: number | null;
}

const CONTENT_PATH_RE = /\/(?:film|series)\/([^/?#]+)/i;

const SEASON_EPISODE_PATTERNS: RegExp[] = [
  /(?:season|сезон)[\s=:_\-–—.]*(\d{1,3}).{0,48}?(?:episode|серия|эпизод)[\s=:_\-–—.]*(\d{1,4})/i,
  /\bs[\s._\-/]?(\d{1,3})[\s._\-/]?e[\s._\-/]?(\d{1,4})\b/i,
  /(?:episode|серия|эпизод)[\s=:_\-–—.]*(\d{1,4})/i,
];

function toPositiveInt(value: string | null | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractContentId(href: string): string | null {
  try {
    const match = CONTENT_PATH_RE.exec(new URL(href).pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function parseSeasonEpisode(text: string): SeasonEpisode {
  for (const pattern of SEASON_EPISODE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (match.length === 3) {
      return {
        season: toPositiveInt(match[1]),
        episode: toPositiveInt(match[2]),
      };
    }
    return {
      season: null,
      episode: toPositiveInt(match[1]),
    };
  }
  return { season: null, episode: null };
}

export function strongEpisodeKey(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const contentId = extractContentId(href);
  const params = url.searchParams;

  const seasonParam =
    toPositiveInt(params.get('season')) ??
    toPositiveInt(params.get('season_id')) ??
    toPositiveInt(params.get('seasonId'));
  const episodeParam = params.get('episode') ?? params.get('episode_id') ?? params.get('episodeId');
  const contentParam = params.get('content_id') ?? params.get('contentId');
  const contentType = (params.get('content_type') ?? params.get('contentType') ?? '').toLowerCase();

  const parsed = parseSeasonEpisode(`${url.pathname}${url.hash}${url.search}`);
  if (contentId && parsed.episode !== null) {
    const season = parsed.season ?? seasonParam ?? 0;
    return `ep:${contentId}:s${season}:e${parsed.episode}`;
  }

  if (episodeParam) {
    const episodeNumber = toPositiveInt(episodeParam);
    if (episodeNumber !== null && contentId) {
      return `ep:${contentId}:s${seasonParam ?? 0}:e${episodeNumber}`;
    }
    return `ep:${episodeParam}`;
  }

  if (contentParam && contentType !== 'film' && contentType !== 'movie') {
    return `ep:${contentParam}`;
  }

  return null;
}
