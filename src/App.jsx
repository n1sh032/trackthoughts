import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [songs, setSongs] = useState([])
  const [showMeaning, setShowMeaning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSongs, setIsLoadingSongs] = useState(true)
  const [isCheckingSpotify, setIsCheckingSpotify] = useState(false)
  const [songIndex, setSongIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [spotifySong, setSpotifySong] = useState(null)
  const [spotifyMessage, setSpotifyMessage] = useState('')

  useEffect(() => {
    async function getSongs() {
      try {
        const response = await fetch('http://127.0.0.1:3000/api/songs')

        if (!response.ok) {
          throw new Error('the server did not send the songs')
        }

        const data = await response.json()
        setSongs(data)
      } catch (err) {
        setError('could not load songs. make sure the server is running.')
      } finally {
        setIsLoadingSongs(false)
      }
    }

    getSongs()
  }, [])

  const song = songs[songIndex]

  function explainSong() {
    setIsLoading(true)
    setShowMeaning(false)

    setTimeout(() => {
      setIsLoading(false)
      setShowMeaning(true)
    }, 700)
  }

  async function getSpotifySong() {
    setIsCheckingSpotify(true)
    setSpotifyMessage('')

    try {
      const response = await fetch(
        'http://127.0.0.1:3000/api/current-song',
        {
          credentials: 'include',
        }
      )

      if (response.status === 401) {
        window.location.href = 'http://127.0.0.1:3000/login'
        return
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'could not get the Spotify song')
      }

      if (!data.title) {
        setSpotifySong(null)
        setSpotifyMessage(data.message)
        return
      }

      setSpotifySong(data)
    } catch (err) {
      setSpotifyMessage('could not get the song from Spotify right now.')
    } finally {
      setIsCheckingSpotify(false)
    }
  }

  const matchingSongs = songs.filter((item) => {
    const songText = `${item.title} ${item.artist}`.toLowerCase()
    return songText.includes(search.toLowerCase())
  })

  if (isLoadingSongs) {
    return (
      <main className="app">
        <p className="logo">trackthoughts</p>
        <p className="intro">getting songs ready...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="app">
        <p className="logo">trackthoughts</p>
        <p className="intro">{error}</p>
      </main>
    )
  }

  return (
    <main className="app">
      <p className="logo">trackthoughts</p>

      <h1>what does this song mean?</h1>
      <p className="intro">understand the feeling behind the songs you love.</p>

      <button
        className="spotify-button"
        onClick={getSpotifySong}
        disabled={isCheckingSpotify}
      >
        {isCheckingSpotify ? 'checking Spotify...' : 'use what I’m playing'}
      </button>

      {spotifyMessage && <p className="spotify-message">{spotifyMessage}</p>}

      {spotifySong && (
        <section className="spotify-card">
          <p className="spotify-label">detected from Spotify</p>

          <div className="spotify-song">
            {spotifySong.image && (
              <img
                className="spotify-art"
                src={spotifySong.image}
                alt={`album cover for ${spotifySong.title}`}
              />
            )}

            <div>
              <h2>{spotifySong.title}</h2>
              <p className="artist">{spotifySong.artist}</p>
              <a
                className="spotify-link"
                href={spotifySong.spotifyUrl}
                target="_blank"
                rel="noreferrer"
              >
                open in Spotify ↗
              </a>
            </div>
          </div>
        </section>
      )}

      <section className="song-card">
        <label className="picker-label" htmlFor="song-search">
          search our demo songs
        </label>

        <input
          className="song-search"
          id="song-search"
          value={search}
          onChange={(event) => {
            const value = event.target.value
            setSearch(value)

            const foundIndex = songs.findIndex((item) => {
              const songText = `${item.title} ${item.artist}`.toLowerCase()
              return songText.includes(value.toLowerCase())
            })

            if (foundIndex !== -1) {
              setSongIndex(foundIndex)
              setShowMeaning(false)
            }
          }}
          placeholder="try drivers license"
        />

        {matchingSongs.length > 0 ? (
          <select
            id="song-picker"
            value={songIndex}
            onChange={(event) => {
              setSongIndex(Number(event.target.value))
              setShowMeaning(false)
            }}
          >
            {matchingSongs.map((item) => (
              <option key={item.title} value={songs.indexOf(item)}>
                {item.title} — {item.artist}
              </option>
            ))}
          </select>
        ) : (
          <p className="no-results">no demo song found yet.</p>
        )}

        <p className="now-playing">now playing</p>
        <h2>{song.title}</h2>
        <p className="artist">{song.artist}</p>

        <button onClick={explainSong} disabled={isLoading}>
          {isLoading
            ? 'finding the feeling...'
            : showMeaning
              ? 'this song is explained'
              : 'explain this song'}
        </button>

        {showMeaning && (
          <div className="meaning">
            <p className="meaning-label">what this song means</p>
            <p>{song.meaning}</p>
            <p>{song.detail}</p>

            <div className="themes">
              {song.themes.map((theme) => (
                <span key={theme}>{theme}</span>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default App