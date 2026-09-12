require('dotenv').config()

const express = require('express')
const cors = require('cors')

const app = express()
const port = 3000

// lets the React app talk to this server later
app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ message: 'trackthoughts server is working' })
})

app.listen(port, () => {
  console.log(`server is running at http://localhost:${port}`)
})