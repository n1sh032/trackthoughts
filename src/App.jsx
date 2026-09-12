import { useState } from 'react'
import './App.css'

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

function App() {
  const [showMeaning, setShowMeaning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [songIndex, setSongIndex] = useState(0)
  const [search, setSearch] = useState('')

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