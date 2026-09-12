import { useState } from 'react'
import './App.css'

function App() {
    const [showMeaning, setShowMeaning] = useState(false)
  return (
    <main className="app">
      <p className="logo">trackthoughts</p>

      <h1>what does this song mean?</h1>
      <p className="intro">understand the feeling behind the songs you love.</p>

      <section className="song-card">
        <p className="now-playing">now playing</p>
        <h2>always</h2>
        <p className="artist">daniel caesar</p>

        <button onClick={() => setShowMeaning(true)}>
  {showMeaning ? 'this song is explained' : 'explain this song'}
</button>

{showMeaning && (
  <div className="meaning">
    <p className="meaning-label">what this song means</p>
    <p>
      it’s about loving someone so deeply that letting them go feels worse than
      the pain of staying.
    </p>
  </div>
)}
      </section>
    </main>
  )
}

export default App