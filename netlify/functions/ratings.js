const fs = require('fs/promises');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'A2diz/spletnitsy';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const RATINGS_FILE_PATH = process.env.RATINGS_FILE_PATH || '_data/ratings.json';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const emptyState = {
  currentBookKey: '',
  currentVotes: [],
  archive: {}
};

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function normalizeState(data = {}) {
  return {
    currentBookKey: typeof data.currentBookKey === 'string' ? data.currentBookKey : '',
    currentVotes: Array.isArray(data.currentVotes) ? data.currentVotes : [],
    archive: data.archive && typeof data.archive === 'object' ? data.archive : {}
  };
}

function encodeGitHubPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

async function readLocalFallback() {
  try {
    const localPath = path.join(process.cwd(), RATINGS_FILE_PATH);
    const raw = await fs.readFile(localPath, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...emptyState };
  }
}

async function readState() {
  const fallback = await readLocalFallback();

  if (!GITHUB_TOKEN) {
    return { data: fallback, sha: null, writable: false };
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeGitHubPath(RATINGS_FILE_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`
      }
    }
  );

  if (response.status === 404) {
    return { data: fallback, sha: null, writable: true };
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub read failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const decoded = Buffer.from(payload.content, 'base64').toString('utf8');

  return {
    data: normalizeState(JSON.parse(decoded)),
    sha: payload.sha,
    writable: true
  };
}

async function writeState(state, sha, message) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not configured.');
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeGitHubPath(RATINGS_FILE_PATH)}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        branch: GITHUB_BRANCH,
        sha: sha || undefined,
        content: Buffer.from(`${JSON.stringify(state, null, 2)}\n`).toString('base64')
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub write failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function buildArchiveEntry(bookKey, votes) {
  const [title = '', author = ''] = bookKey.split('|');
  const avgRating = votes.length
    ? Number((votes.reduce((sum, vote) => sum + Number(vote.rating || 0), 0) / votes.length).toFixed(2))
    : null;

  return {
    title,
    author,
    rating: avgRating,
    voteCount: votes.length,
    votes,
    archivedDate: new Date().toISOString()
  };
}

function syncBookState(state, bookKey, title, author) {
  const nextState = normalizeState(state);

  if (!bookKey) {
    return nextState;
  }

  if (nextState.currentBookKey && nextState.currentBookKey !== bookKey && nextState.currentVotes.length > 0) {
    nextState.archive[nextState.currentBookKey] = buildArchiveEntry(nextState.currentBookKey, nextState.currentVotes);
  }

  if (nextState.currentBookKey !== bookKey) {
    nextState.currentBookKey = bookKey;
    nextState.currentVotes = [];
  }

  if (title && author && nextState.archive[bookKey]) {
    nextState.archive[bookKey].title = title;
    nextState.archive[bookKey].author = author;
  }

  return nextState;
}

async function saveWithRetry(state, sha, message, retryCount = 1) {
  try {
    await writeState(state, sha, message);
    return true;
  } catch (error) {
    if (retryCount <= 0 || !String(error.message).includes('409')) {
      throw error;
    }

    const latest = await readState();
    const merged = normalizeState(latest.data);
    merged.currentBookKey = state.currentBookKey;
    merged.currentVotes = state.currentVotes;
    merged.archive = state.archive;

    await writeState(merged, latest.sha, message);
    return true;
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      const bookKey = params.get('bookKey') || '';
      const title = params.get('title') || '';
      const author = params.get('author') || '';

      const { data, sha, writable } = await readState();
      const normalized = normalizeState(data);
      const synced = syncBookState(normalized, bookKey, title, author);

      if (writable && JSON.stringify(synced) !== JSON.stringify(normalized)) {
        await saveWithRetry(synced, sha, `Sync ratings state for ${title || 'current book'}`);
      }

      return buildResponse(200, {
        ok: true,
        storage: writable ? 'shared' : 'readonly',
        ...synced
      });
    }

    if (event.httpMethod !== 'POST') {
      return buildResponse(405, { ok: false, error: 'Method Not Allowed' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return buildResponse(400, { ok: false, error: 'Invalid JSON' });
    }

    const {
      action,
      bookKey = '',
      title = '',
      author = '',
      name = '',
      rating,
      id
    } = body;

    if (!bookKey) {
      return buildResponse(400, { ok: false, error: 'Missing bookKey' });
    }

    const current = await readState();
    if (!current.writable) {
      return buildResponse(503, {
        ok: false,
        error: 'Shared storage is not configured yet. Add GITHUB_TOKEN to the Netlify environment.'
      });
    }

    const state = syncBookState(current.data, bookKey, title, author);

    if (action === 'upsertVote') {
      const trimmedName = String(name).trim();
      const numericRating = Number(rating);

      if (!trimmedName) {
        return buildResponse(400, { ok: false, error: 'Name is required' });
      }

      if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 10) {
        return buildResponse(400, { ok: false, error: 'Rating must be between 1 and 10' });
      }

      const existingIndex = state.currentVotes.findIndex(
        vote => String(vote.name).trim().toLowerCase() === trimmedName.toLowerCase()
      );

      const nextVote = {
        id: existingIndex >= 0 ? state.currentVotes[existingIndex].id : Date.now(),
        name: trimmedName,
        rating: numericRating
      };

      if (existingIndex >= 0) {
        state.currentVotes[existingIndex] = nextVote;
      } else {
        state.currentVotes.push(nextVote);
      }
    } else if (action === 'deleteVote') {
      state.currentVotes = state.currentVotes.filter(vote => String(vote.id) !== String(id));
    } else if (action !== 'syncBook') {
      return buildResponse(400, { ok: false, error: 'Unknown action' });
    }

    await saveWithRetry(state, current.sha, `Update ratings for ${title || bookKey}`);

    return buildResponse(200, {
      ok: true,
      storage: 'shared',
      ...state
    });
  } catch (error) {
    return buildResponse(500, {
      ok: false,
      error: error.message || 'Unexpected ratings error'
    });
  }
};
