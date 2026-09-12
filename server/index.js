require('dotenv').config()

const crypto = require('crypto')
const express = require('express')
const cors = require('cors')

const app = express()
const port = 3000

// this server is designed for a single person running trackthoughts for
// themselves (used by a browser extension), so we keep everything in
// memory instead of building out multi-user sessions.

const spotify = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0, // epoch ms
}

let pendingLoginState = null

// title::artist -> { meaning, detail, themes, cachedAt }
const meaningCache = new Map()

app.use(
  cors({
    origin: true, // reflects request origin, works for chrome-extension:// too
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
    scope: 'user-read-currently-playing',
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

  if (!response.ok) return false

  const data = await response.json()
  spotify.accessToken = data.access_token
  spotify.expiresAt = Date.now() + data.expires_in * 1000
  if (data.refresh_token) spotify.refreshToken = data.refresh_token

  return true
}

app.get('/api/connection-status', (req, res) => {
  res.json({ connected: Boolean(spotify.refreshToken) })
})

// ---------- currently playing ----------

app.get('/api/current-song', async (req, res) => {
  if (!spotify.refreshToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  const ok = await ensureFreshToken()
  if (!ok) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const spotifyResponse = await fetch(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { headers: { Authorization: `Bearer ${spotify.accessToken}` } }
    )

    if (spotifyResponse.status === 204) {
      return res.json({ message: 'nothing is playing right now' })
    }

    const spotifyData = await spotifyResponse.json()

    if (!spotifyResponse.ok) {
      return res.status(spotifyResponse.status).json(spotifyData)
    }

    if (spotifyData.currently_playing_type !== 'track' || !spotifyData.item) {
      return res.json({ message: 'no track is playing right now' })
    }

    res.json({
      title: spotifyData.item.name,
      artist: spotifyData.item.artists.map((artist) => artist.name).join(', '),
      spotifyUrl: spotifyData.item.external_urls.spotify,
      image: spotifyData.item.album.images[0]?.url || null,
      isPlaying: spotifyData.is_playing,
    })
  } catch (err) {
    res.status(500).json({ message: 'could not get the current song' })
  }
})

// ---------- meaning generation ----------

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

    // We only ever pull metadata/annotation text here, never lyrics -
    // Genius's API doesn't expose full lyrics text anyway.
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
            'You write short, warm, insightful interpretations of what a song is about for a music app called trackthoughts. ' +
            'Never quote or reproduce actual lyrics. Respond with ONLY a JSON object, no markdown fences, no preamble, ' +
            'in this exact shape: {"meaning": string (1 sentence, the core idea), "detail": string (2-3 sentences, deeper read), ' +
            '"themes": [string, string, string] (short lowercase theme tags)}.',
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
  const text = data.choices?.[0]?.message?.content || '{}'
  const cleaned = text.replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}
app.get('/api/meaning', async (req, res) => {
  const { title, artist } = req.query

  if (!title || !artist) {
    return res.status(400).json({ message: 'title and artist are required' })
  }

  const key = `${title}::${artist}`.toLowerCase()
  const cached = meaningCache.get(key)
  if (cached) {
    return res.json({ ...cached, cached: true })
  }

  try {
    const context = await getGeniusContext(title, artist)
    const meaning = await generateMeaning(title, artist, context)

    const result = {
      meaning: meaning.meaning,
      detail: meaning.detail,
      themes: meaning.themes || [],
      geniusUrl: context?.geniusUrl || null,
      cached: false,
    }

    meaningCache.set(key, result)
    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'could not generate a meaning for this song right now' })
  }
})

// convenience endpoint: current song + its meaning in one call, which is
// what the extension polls
app.get('/api/now', async (req, res) => {
  if (!spotify.refreshToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  const ok = await ensureFreshToken()
  if (!ok) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const spotifyResponse = await fetch(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { headers: { Authorization: `Bearer ${spotify.accessToken}` } }
    )

    if (spotifyResponse.status === 204) {
      return res.json({ message: 'nothing is playing right now' })
    }

    const spotifyData = await spotifyResponse.json()

    if (!spotifyResponse.ok) {
      return res.status(spotifyResponse.status).json(spotifyData)
    }

    if (spotifyData.currently_playing_type !== 'track' || !spotifyData.item) {
      return res.json({ message: 'no track is playing right now' })
    }

    const song = {
      title: spotifyData.item.name,
      artist: spotifyData.item.artists.map((artist) => artist.name).join(', '),
      spotifyUrl: spotifyData.item.external_urls.spotify,
      image: spotifyData.item.album.images[0]?.url || null,
      isPlaying: spotifyData.is_playing,
      trackId: spotifyData.item.id,
    }

    const key = `${song.title}::${song.artist}`.toLowerCase()
    let meaning = meaningCache.get(key)

    if (!meaning) {
      try {
        const context = await getGeniusContext(song.title, song.artist)
        const generated = await generateMeaning(song.title, song.artist, context)
        meaning = {
          meaning: generated.meaning,
          detail: generated.detail,
          themes: generated.themes || [],
          geniusUrl: context?.geniusUrl || null,
        }
        meaningCache.set(key, meaning)
      } catch (err) {
        meaning = null
      }
    }

    res.json({ song, meaning })
  } catch (err) {
    res.status(500).json({ message: 'could not get the current song' })
  }
})

app.listen(port, () => {
  console.log(`server is running at http://127.0.0.1:${port}`)
})