import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [songs, setSongs] = useState([])
  const [showMeaning, setShowMeaning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSongs, setIsLoadingSongs] = useState(true)
  const [songIndex, setSongIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function getSongs() {
      try {
        const response = await fetch('http://localhost:3000/api/songs')

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