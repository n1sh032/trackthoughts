//require('dotenv').config()

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const express = require('express')
const cors = require('cors')

const app = express()
const port = 3000

// this server is designed for a single person running trackthoughts for
// themselves (used by a browser extension), so we keep everything in
// memory - but persist to small local files so restarts don't lose
// your Spotify connection or the meanings you've already paid to generate.

const TOKENS_FILE = path.join(__dirname, 'spotify-tokens.json')
const CACHE_FILE = path.join(__dirname, 'meaning-cache.json')

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return fallback
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error(`could not save ${file}`, err)
  }
}

const spotify = loadJSON(TOKENS_FILE, {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
})

let pendingLoginState = null

// title::artist -> { meaning, detail, themes, geniusUrl }
const meaningCache = new Map(Object.entries(loadJSON(CACHE_FILE, {})))
function saveMeaningCache() {
  saveJSON(CACHE_FILE, Object.fromEntries(meaningCache))
}

// title::artist -> { deepDive }
const DEEP_CACHE_FILE = path.join(__dirname, 'deep-cache.json')
const deepCache = new Map(Object.entries(loadJSON(DEEP_CACHE_FILE, {})))
function saveDeepCache() {
  saveJSON(DEEP_CACHE_FILE, Object.fromEntries(deepCache))
}

// avoids double-generating (and double-billing) if two requests for the
// same not-yet-cached song land at the same time
const pendingMeanings = new Map()
const pendingDeepDives = new Map()
// lyrics are free (no OpenAI cost) so we just cache them forever once found
const LYRICS_CACHE_FILE = path.join(__dirname, 'lyrics-cache.json')
const lyricsCache = new Map(Object.entries(loadJSON(LYRICS_CACHE_FILE, {})))
function saveLyricsCache() {
  saveJSON(LYRICS_CACHE_FILE, Object.fromEntries(lyricsCache))
}
// tracks REAL spend using the token counts OpenAI actually reports back -
// checkable at /api/usage, and self-enforces a hard cap since this uses
// a borrowed API key
const USAGE_FILE = path.join(__dirname, 'usage.json')
const usage = loadJSON(USAGE_FILE, { totalGenerations: 0, totalCostUsd: 0 })
function saveUsage() {
  saveJSON(USAGE_FILE, usage)
}

const PRICE_PER_INPUT_TOKEN = 0.15 / 1_000_000
const PRICE_PER_OUTPUT_TOKEN = 0.6 / 1_000_000

function recordSpend(data) {
  const promptTokens = data.usage?.prompt_tokens || 0
  const completionTokens = data.usage?.completion_tokens || 0
  usage.totalGenerations += 1
  usage.totalCostUsd += promptTokens * PRICE_PER_INPUT_TOKEN + completionTokens * PRICE_PER_OUTPUT_TOKEN
  saveUsage()
}

function checkSpendCap() {
  const cap = process.env.MAX_SPEND_USD ? parseFloat(process.env.MAX_SPEND_USD) : null
  if (cap !== null && usage.totalCostUsd >= cap) {
    const err = new Error('spend cap reached')
    err.capReached = true
    throw err
  }
}

app.use(
  cors({
    origin: true,
    credentials: false,
  })
)

app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ message: 'trackthoughts server is working' })
})

// ---------- Spotify auth ----------

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex')
  pendingLoginState = state

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
    state,
  })

  res.redirect(`https://accounts.spotify.com/authorize?${params}`)
})

app.get('/callback', async (req, res) => {
  const { code, state } = req.query

  if (!code || state !== pendingLoginState) {
    return res.status(400).send('spotify sign-in did not work. please try again.')
  }
  pendingLoginState = null

  try {
    const loginDetails = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64')

    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${loginDetails}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (!tokenResponse.ok) {
      return res.status(400).json(tokenData)
    }

    spotify.accessToken = tokenData.access_token
    spotify.refreshToken = tokenData.refresh_token
    spotify.expiresAt = Date.now() + tokenData.expires_in * 1000
    saveJSON(TOKENS_FILE, spotify)

    res.send(
      '<html><body style="font-family: sans-serif; padding: 40px;">' +
        '<h2>Spotify connected ✅</h2>' +
        '<p>You can close this tab and go back to the trackthoughts extension.</p>' +
        '</body></html>'
    )
  } catch (err) {
    res.status(500).send('something went wrong while connecting Spotify.')
  }
})

async function ensureFreshToken() {
  if (!spotify.refreshToken) return false
  if (spotify.accessToken && Date.now() < spotify.expiresAt - 30_000) return true

  const loginDetails = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${loginDetails}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotify.refreshToken,
    }),
  })

  if (!response.ok) {
    // refresh token itself was revoked/expired - clear it so the UI
    // correctly asks the person to reconnect instead of looping forever
    if (response.status === 400 || response.status === 401) {
      spotify.accessToken = null
      spotify.refreshToken = null
      spotify.expiresAt = 0
      saveJSON(TOKENS_FILE, spotify)
    }
    return false
  }

  const data = await response.json()
  spotify.accessToken = data.access_token
  spotify.expiresAt = Date.now() + data.expires_in * 1000
  if (data.refresh_token) spotify.refreshToken = data.refresh_token
  saveJSON(TOKENS_FILE, spotify)

  return true
}

app.get('/api/connection-status', (req, res) => {
  res.json({ connected: Boolean(spotify.refreshToken) })
})

// ---------- currently playing ----------

async function getCurrentSpotifySong() {
  const spotifyResponse = await fetch(
    'https://api.spotify.com/v1/me/player/currently-playing',
    { headers: { Authorization: `Bearer ${spotify.accessToken}` } }
  )

  if (spotifyResponse.status === 204) {
    return { message: 'nothing is playing right now' }
  }

  const spotifyData = await spotifyResponse.json()

  if (!spotifyResponse.ok) {
    const err = new Error('spotify api error')
    err.status = spotifyResponse.status
    err.body = spotifyData
    throw err
  }

  if (spotifyData.currently_playing_type !== 'track' || !spotifyData.item) {
    return { message: 'no track is playing right now' }
  }

  return {
    title: spotifyData.item.name,
    artist: spotifyData.item.artists.map((artist) => artist.name).join(', '),
    spotifyUrl: spotifyData.item.external_urls.spotify,
    image: spotifyData.item.album.images[0]?.url || null,
    isPlaying: spotifyData.is_playing,
    trackId: spotifyData.item.id,
  }
}

app.get('/api/current-song', async (req, res) => {
  if (!spotify.refreshToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }
  const ok = await ensureFreshToken()
  if (!ok) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const song = await getCurrentSpotifySong()
    res.json(song)
  } catch (err) {
    res.status(err.status || 500).json(err.body || { message: 'could not get the current song' })
  }
})

// ---------- meaning generation (only ever runs on demand) ----------

async function getGeniusContext(title, artist) {
  if (!process.env.GENIUS_ACCESS_TOKEN) return null

  try {
    const searchResponse = await fetch(
      `https://api.genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`,
      { headers: { Authorization: `Bearer ${process.env.GENIUS_ACCESS_TOKEN}` } }
    )
    if (!searchResponse.ok) return null

    const searchData = await searchResponse.json()
    const hit = searchData.response?.hits?.[0]?.result
    if (!hit) return null

    const songResponse = await fetch(
      `https://api.genius.com/songs/${hit.id}?text_format=plain`,
      { headers: { Authorization: `Bearer ${process.env.GENIUS_ACCESS_TOKEN}` } }
    )
    if (!songResponse.ok) return null

    const songData = await songResponse.json()
    const song = songData.response?.song
    const description = song?.description?.plain?.slice(0, 800) || null

    return {
      geniusUrl: song?.url || hit.url || null,
      releaseDate: song?.release_date_for_display || null,
      description,
    }
  } catch (err) {
    return null
  }
}

async function generateMeaning(title, artist, context) {
  const contextLine = context?.description
    ? `Background notes from Genius (for context only, do not quote directly): ${context.description}`
    : 'No extra background notes are available - rely on general knowledge of the song.'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You explain what a song actually means, the way one friend would explain it to another who just asked "wait, what is ' +
            'this song even about?" Your job is to find the ONE specific emotional truth at the core of the song and say it ' +
            'straight - not a mood, not a topic, an actual realization. Write directly to the listener using "you" as if the ' +
            'song\'s narrator is them. Be concrete about the exact situation: who they are to each other, what they want, what ' +
            'they are settling for, what they are pretending not to feel. Do not describe the song from outside it ("this song ' +
            'is about heartbreak and longing"). State the specific belief or bargain the narrator has made with themselves, the ' +
            'way you\'d explain a friend\'s messy situation back to them in one clear sentence they hadn\'t put into words yet.\n\n' +
            'Ban list - never use these words/phrases or anything that sounds like them: "explores", "themes of", "juxtaposes", ' +
            '"narrative", "delve", "raw and vulnerable", "journey", "grapples with", "captures the feeling of", "a testament to". ' +
            'If your sentence could be printed on a music blog, rewrite it. Never quote or reproduce actual lyrics.\n\n' +
            'Example of the voice you should write in, for a song about loving someone who\'s moved on but staying anyway: "its ' +
            'about loving someone so deeply that youd rather stay in pain than let them go, you dont mind they are with someone ' +
            'new, youll still wait quietly in the background. you keep hoping nothing ever changes even if it means you stay ' +
            'hurting forever because deep down you are not temporary to them, you are just the one who will never leave." Match ' +
            'that level of specificity and that voice - lowercase, run-on, honest, landing on one exact realization - not the ' +
            'exact wording.\n\n' +
            'Respond with ONLY a JSON object, no markdown fences, no preamble, in this exact shape: ' +
            '{"meaning": string (1-2 sentences, the specific realization stated plainly, in the voice and specificity of the ' +
            'example above), "detail": string (2-4 more sentences pushing further into the exact situation - what they tell ' +
            'themselves to make it bearable, what they are actually afraid of), "themes": [string, string, string] (short ' +
            'lowercase phrases naming the specific dynamic, not generic mood words - "not temporary to them" not "longing")}.',
        },
        {
          role: 'user',
          content: `Song: "${title}" by ${artist}.\n${contextLine}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`openai api error: ${response.status}`)
  }

  const data = await response.json()
  recordSpend(data)
  const text = data.choices?.[0]?.message?.content || '{}'
  const cleaned = text.replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}

function cacheKey(title, artist) {
  return `${title}::${artist}`.toLowerCase()
}

async function getOrGenerateMeaning(title, artist) {
  const key = cacheKey(title, artist)

  if (meaningCache.has(key)) {
    const cached = meaningCache.get(key)
    if (cached && cached.meaning && cached.detail) {
      return { ...cached, cached: true }
    }
    meaningCache.delete(key)
  }

  // if a generation for this exact song is already in flight, piggyback
  // on it instead of firing a second (paid) request
  if (pendingMeanings.has(key)) {
    return pendingMeanings.get(key)
  }

  const promise = (async () => {
    const context = await getGeniusContext(title, artist)
    const generated = await generateMeaning(title, artist, context)
    if (!generated.meaning || !generated.detail) {
      throw new Error('model did not return a valid meaning')
    }
    const result = {
      meaning: generated.meaning,
      detail: generated.detail,
      themes: generated.themes || [],
      geniusUrl: context?.geniusUrl || null,
    }
    meaningCache.set(key, result)
    saveMeaningCache()
    return { ...result, cached: false }
  })()

  pendingMeanings.set(key, promise)
  try {
    return await promise
  } finally {
    pendingMeanings.delete(key)
  }
}

async function generateDeepDive(title, artist, quickMeaning, context) {
  const contextLine = context?.description
    ? `Background notes from Genius (for context only, do not quote directly): ${context.description}`
    : 'No extra background notes are available - rely on general knowledge of the song.'

  const priorLine = quickMeaning
    ? `You already told the listener: "${quickMeaning.meaning}" ${quickMeaning.detail || ''}`.trim()
    : ''

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'The listener already has the one-line read on this song. Now go further - not longer, further. Each paragraph ' +
            'should surface something the quick read did not say: the specific moment that would have triggered this feeling, ' +
            'the contradiction the narrator is living inside (what they say vs. what they actually want), what they are avoiding ' +
            'admitting to themselves, and what it would take for this to actually change. Write directly to the listener as ' +
            '"you", concrete and specific to this exact relationship dynamic - never generic statements that could apply to any ' +
            'sad song. If a paragraph could be moved to a different song\'s deep dive without editing it, it is too generic - ' +
            'rewrite it to be specific to this one.\n\n' +
            'Ban list - never use: "explores", "themes of", "juxtaposes", "narrative arc", "delve", "journey", "grapples with", ' +
            '"a testament to", "underscores", "poignant". Plain, lowercase-friendly, honest language - like a friend who has sat ' +
            'with this song enough times to actually understand what\'s happening in it. Never quote or reproduce actual lyrics.\n\n' +
            'Respond with ONLY a JSON object, no markdown fences, no preamble, in this exact shape: {"deepDive": string (3-5 ' +
            'paragraphs separated by \\n\\n, each one surfacing a specific new angle, not a restatement of the quick meaning)}.',
        },
        {
          role: 'user',
          content: `Song: "${title}" by ${artist}.\n${priorLine}\n${contextLine}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`openai api error: ${response.status}`)
  }

  const data = await response.json()
  recordSpend(data)
  const text = data.choices?.[0]?.message?.content || '{}'
  const cleaned = text.replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}

async function getOrGenerateDeepDive(title, artist) {
  const key = cacheKey(title, artist)

  if (deepCache.has(key)) {
    const cached = deepCache.get(key)
    if (cached && typeof cached.deepDive === 'string') {
      return { ...cached, cached: true }
    }
    // malformed entry from before validation was added - drop it and regenerate
    deepCache.delete(key)
  }

  checkSpendCap()

  if (pendingDeepDives.has(key)) {
    return pendingDeepDives.get(key)
  }
  const promise = (async () => {
    const [context, quickMeaning] = await Promise.all([
      getGeniusContext(title, artist),
      getOrGenerateMeaning(title, artist),
    ])
    const generated = await generateDeepDive(title, artist, quickMeaning, context)
    if (!generated.deepDive || typeof generated.deepDive !== 'string') {
      throw new Error('model did not return a deepDive string')
    }
    const result = { deepDive: generated.deepDive }
    deepCache.set(key, result)
    saveDeepCache()
    return { ...result, cached: false }
  })()

  pendingDeepDives.set(key, promise)
  try {
    return await promise
  } finally {
    pendingDeepDives.delete(key)
  }
}

// on-demand only - this is the one endpoint that ever spends an OpenAI call
app.get('/api/usage', (req, res) => {
  const cap = process.env.MAX_SPEND_USD ? parseFloat(process.env.MAX_SPEND_USD) : null
  res.json({
    totalGenerations: usage.totalGenerations,
    totalCostUsd: Number(usage.totalCostUsd.toFixed(4)),
    capUsd: cap,
    remainingUsd: cap !== null ? Number((cap - usage.totalCostUsd).toFixed(4)) : null,
  })
})

app.get('/api/meaning', async (req, res) => {
  const { title, artist, depth } = req.query

  if (!title || !artist) {
    return res.status(400).json({ message: 'title and artist are required' })
  }

  try {
    if (depth === 'deep') {
      const result = await getOrGenerateDeepDive(title, artist)
      return res.json(result)
    }

    const result = await getOrGenerateMeaning(title, artist)
    res.json(result)
  } catch (err) {
    if (err.capReached) {
      return res
        .status(402)
        .json({ message: `spend cap of $${process.env.MAX_SPEND_USD} reached - ask your friend to raise it` })
    }
    const message =
      depth === 'deep'
        ? 'could not go deeper on this song right now'
        : 'could not generate a meaning for this song right now'
    res.status(500).json({ message })
  }
})

// polled endpoint - current song + meaning IF already cached. never
// generates a new one, so background polling never costs anything.
app.get('/api/now', async (req, res) => {
  if (!spotify.refreshToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }
  const ok = await ensureFreshToken()
  if (!ok) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const song = await getCurrentSpotifySong()

    if (!song.title) {
      return res.json({ message: song.message })
    }

    const cached = meaningCache.get(cacheKey(song.title, song.artist))
    res.json({ song, meaning: cached || null })
  } catch (err) {
    res.status(err.status || 500).json(err.body || { message: 'could not get the current song' })
  }
})

// ---------- live player state (progress, volume) ----------

async function getFullPlayerState() {
  const spotifyResponse = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${spotify.accessToken}` },
  })

  if (spotifyResponse.status === 204) {
    return { message: 'nothing is playing right now' }
  }

  const spotifyData = await spotifyResponse.json()

  if (!spotifyResponse.ok) {
    const err = new Error('spotify api error')
    err.status = spotifyResponse.status
    err.body = spotifyData
    throw err
  }

  if (spotifyData.currently_playing_type !== 'track' || !spotifyData.item) {
    return { message: 'no track is playing right now' }
  }

  return {
    title: spotifyData.item.name,
    artist: spotifyData.item.artists.map((artist) => artist.name).join(', '),
    spotifyUrl: spotifyData.item.external_urls.spotify,
    image: spotifyData.item.album.images[0]?.url || null,
    isPlaying: spotifyData.is_playing,
    trackId: spotifyData.item.id,
    progressMs: spotifyData.progress_ms || 0,
    durationMs: spotifyData.item.duration_ms || 0,
    volumePercent: spotifyData.device?.volume_percent ?? null,
  }
}

app.get('/api/player-state', async (req, res) => {
  if (!spotify.refreshToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }
  const ok = await ensureFreshToken()
  if (!ok) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const state = await getFullPlayerState()
    res.json(state)
  } catch (err) {
    res.status(err.status || 500).json(err.body || { message: 'could not get player state' })
  }
})

app.put('/api/player/volume', async (req, res) => {
  const percent = Math.round(Number(req.query.percent))
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return res.status(400).json({ message: 'percent must be a number between 0 and 100' })
  }

  const ok = await ensureFreshToken()
  if (!ok) return res.status(401).json({ message: 'connect Spotify first' })

  try {
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/volume?volume_percent=${percent}`,
      { method: 'PUT', headers: { Authorization: `Bearer ${spotify.accessToken}` } }
    )
    if (!response.ok && response.status !== 204) {
      const body = await response.json().catch(() => ({}))
      return res.status(response.status).json(body)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: 'could not change volume - is Spotify open and active on a device?' })
  }
})

app.put('/api/player/seek', async (req, res) => {
  const positionMs = Math.round(Number(req.query.positionMs))
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return res.status(400).json({ message: 'positionMs must be a positive number' })
  }

  const ok = await ensureFreshToken()
  if (!ok) return res.status(401).json({ message: 'connect Spotify first' })

  try {
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`,
      { method: 'PUT', headers: { Authorization: `Bearer ${spotify.accessToken}` } }
    )
    if (!response.ok && response.status !== 204) {
      const body = await response.json().catch(() => ({}))
      return res.status(response.status).json(body)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: 'could not seek - is Spotify open and active on a device?' })
  }
})

// ---------- synced lyrics (free, via lrclib.net - no key needed) ----------

function cleanTitleForLyrics(title) {
  return title
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\[feat\.[^\]]*\]/gi, '')
    .replace(/-\s*(bonus|remaster(ed)?( \d{4})?|deluxe|live|radio edit|single version).*/gi, '')
    .trim()
}

function parseLrc(syncedLyrics) {
  const lineRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)/
  const result = []

  for (const line of syncedLyrics.split('\n')) {
    const match = line.match(lineRegex)
    if (!match) continue
    const text = match[3].trim()
    if (!text) continue
    const timeMs = Math.round((parseInt(match[1], 10) * 60 + parseFloat(match[2])) * 1000)
    result.push({ timeMs, text })
  }

  return result
}

async function fetchSyncedLyrics(title, artist, durationMs) {
  const params = new URLSearchParams({
    track_name: cleanTitleForLyrics(title),
    artist_name: artist,
  })
  if (durationMs) {
    params.set('duration', String(Math.round(durationMs / 1000)))
  }

  const response = await fetch(`https://lrclib.net/api/get?${params}`)
  if (!response.ok) return null

  const data = await response.json()
  if (!data.syncedLyrics) return null

  return parseLrc(data.syncedLyrics)
}

app.get('/api/lyrics', async (req, res) => {
  const { title, artist, durationMs } = req.query

  if (!title || !artist) {
    return res.status(400).json({ message: 'title and artist are required' })
  }

  const key = cacheKey(title, artist)

  if (lyricsCache.has(key)) {
    const cached = lyricsCache.get(key)
    if (cached === null) {
      return res.json({ lines: null, message: 'no synced lyrics found for this song' })
    }
    return res.json({ lines: cached, cached: true })
  }

  try {
    const lines = await fetchSyncedLyrics(title, artist, Number(durationMs) || null)
    lyricsCache.set(key, lines && lines.length > 0 ? lines : null)
    saveLyricsCache()

    if (!lines || lines.length === 0) {
      return res.json({ lines: null, message: 'no synced lyrics found for this song' })
    }
    res.json({ lines, cached: false })
  } catch (err) {
    res.status(500).json({ message: 'could not fetch lyrics right now' })
  }
})

app.listen(port, () => {
  console.log(`server is running at http://127.0.0.1:${port}`)
})