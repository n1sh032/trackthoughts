import { useState } from 'react'
import './App.css'

const songs = [
  {
    title: 'always',
    artist: 'daniel caesar',
    meaning:
      'it’s about loving someone so deeply that letting them go feels worse than the pain of staying.',
  },
  {
    title: 'drivers license',
    artist: 'olivia rodrigo',
    meaning:
      'it’s about replaying a breakup in your head while everyday places and memories make it impossible to move on.',
  },
]

function App() {
  const [showMeaning, setShowMeaning] = useState(false)
  const [songIndex, setSongIndex] = useState(0)
  const song = songs[songIndex]

  return (
    <main className="app">
      <p className="logo">trackthoughts</p>

      <h1>what does this song mean?</h1>
      <p className="intro">understand the feeling behind the songs you love.</p>

      <section className="song-card">
        <label className="picker-label" htmlFor="song-picker">
          try a different song
        </label>

        <select
          id="song-picker"
          value={songIndex}
          onChange={(event) => {
            setSongIndex(Number(event.target.value))
            setShowMeaning(false)
          }}
        >
          {songs.map((song, index) => (
            <option key={song.title} value={index}>
              {song.title} — {song.artist}
            </option>
          ))}
        </select>

        <p className="now-playing">now playing</p>
        <h2>{song.title}</h2>
        <p className="artist">{song.artist}</p>

        <button onClick={() => setShowMeaning(true)}>
          {showMeaning ? 'this song is explained' : 'explain this song'}
        </button>

        {showMeaning && (
          <div className="meaning">
            <p className="meaning-label">what this song means</p>
            <p>{song.meaning}</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App