require('dotenv').config()

const express = require('express')
const cors = require('cors')

const app = express()
const port = 3000

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

// lets the React app talk to this server later
app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ message: 'trackthoughts server is working' })
})

app.get('/api/songs', (req, res) => {
  res.json(songs)
})

app.listen(port, () => {
  console.log(`server is running at http://localhost:${port}`)
})