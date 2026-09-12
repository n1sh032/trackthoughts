require('dotenv').config()

const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const session = require('express-session')

const app = express()
const port = 3000
const frontendUrl = 'http://127.0.0.1:5173'

const songs = [
  {
    title: 'always',
    artist: 'daniel caesar',
    meaning:
      'it’s about loving someone so deeply that letting them go feels worse than the pain of staying.',
    detail:
      'even if the other person moves on, he would rather wait quietly in the background than disappear from their life. it is the feeling of being the one who never leaves.',
    themes: ['longing', 'loyalty', 'heartbreak'],
  },
  {
    title: 'drivers license',
    artist: 'olivia rodrigo',
    meaning:
      'it’s about replaying a breakup in your head while everyday places and memories make it impossible to move on.',
    detail:
      'getting her licence was supposed to be exciting, but it becomes another reminder of the person she imagined sharing that moment with.',
    themes: ['first heartbreak', 'jealousy', 'nostalgia'],
  },
]

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
)

app.use(express.json())

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })
)

app.get('/api/health', (req, res) => {
  res.json({ message: 'trackthoughts server is working' })
})

app.get('/api/songs', (req, res) => {
  res.json(songs)
})

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex')

  req.session.spotifyState = state

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

  if (!code || state !== req.session.spotifyState) {
    return res.status(400).send('spotify sign-in did not work. please try again.')
  }

  try {
    const loginDetails = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64')

    const tokenResponse = await fetch(
      'https://accounts.spotify.com/api/token',
      {
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
      }
    )

    const tokenData = await tokenResponse.json()

    if (!tokenResponse.ok) {
      return res.status(400).json(tokenData)
    }

    req.session.accessToken = tokenData.access_token
    req.session.refreshToken = tokenData.refresh_token
    delete req.session.spotifyState

    res.redirect(`${frontendUrl}/?spotify=connected`)
  } catch (err) {
    res.status(500).send('something went wrong while connecting Spotify.')
  }
})

app.get('/api/current-song', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ message: 'connect Spotify first' })
  }

  try {
    const spotifyResponse = await fetch(
      'https://api.spotify.com/v1/me/player/currently-playing',
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
        },
      }
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

app.listen(port, () => {
  console.log(`server is running at http://127.0.0.1:${port}`)
})