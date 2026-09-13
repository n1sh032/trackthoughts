const API_BASE = 'http://127.0.0.1:3000'

const connectView = document.getElementById('connect-view')
const statusView = document.getElementById('status-view')
const songView = document.getElementById('song-view')
const statusText = document.getElementById('status-text')
const statusDot = document.getElementById('status-dot')
const actionError = document.getElementById('action-error')

const songArt = document.getElementById('song-art')
const songTitle = document.getElementById('song-title')
const songArtist = document.getElementById('song-artist')
const songLink = document.getElementById('song-link')
const eq = document.getElementById('eq')

const explainBlock = document.getElementById('explain-block')
const explainButton = document.getElementById('explain-button')
const meaningBlock = document.getElementById('meaning-block')
const meaningText = document.getElementById('meaning-text')
const meaningDetail = document.getElementById('meaning-detail')
const meaningThemes = document.getElementById('meaning-themes')
const meaningLoading = document.getElementById('meaning-loading')

const deeperBlock = document.getElementById('deeper-block')
const deeperButton = document.getElementById('deeper-button')
const deepLoading = document.getElementById('deep-loading')
const deepBlock = document.getElementById('deep-block')
const deepText = document.getElementById('deep-text')

document.getElementById('connect-button').addEventListener('click', () => {
  chrome.tabs.create({ url: `${API_BASE}/login` })
})

document.getElementById('refresh-button').addEventListener('click', refresh)
document.getElementById('refresh-button-2').addEventListener('click', refresh)

function refresh() {
  chrome.runtime.sendMessage({ type: 'REFRESH_NOW' }, render)
}

function showOnly(view) {
  ;[connectView, statusView, songView].forEach((el) => el.classList.add('hidden'))
  view.classList.remove('hidden')
}

function showError(message) {
  actionError.textContent = message
  actionError.classList.remove('hidden')
}

async function fetchMeaning(title, artist, depth) {
  const response = await fetch(
    `${API_BASE}/api/meaning?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&depth=${depth}`
  )
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.message || 'something went wrong')
  }
  return result
}

explainButton.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['song'])
  if (!data.song) return

  actionError.classList.add('hidden')
  explainBlock.classList.add('hidden')
  meaningLoading.classList.remove('hidden')

  try {
    const result = await fetchMeaning(data.song.title, data.song.artist, 'quick')
    const stillSameSong = await chrome.storage.local.get(['song'])
    if (stillSameSong.song?.title === data.song.title && stillSameSong.song?.artist === data.song.artist) {
      await chrome.storage.local.set({ meaning: result })
    }
  } catch (err) {
    meaningLoading.classList.add('hidden')
    explainBlock.classList.remove('hidden')
    showError(err.message)
  }

  render()
})

deeperButton.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['song'])
  if (!data.song) return

  actionError.classList.add('hidden')
  deeperBlock.classList.add('hidden')
  deepLoading.classList.remove('hidden')

  try {
    const result = await fetchMeaning(data.song.title, data.song.artist, 'deep')
    const stillSameSong = await chrome.storage.local.get(['song'])
    if (stillSameSong.song?.title === data.song.title && stillSameSong.song?.artist === data.song.artist) {
      await chrome.storage.local.set({ deepMeaning: result })
    }
  } catch (err) {
    deepLoading.classList.add('hidden')
    deeperBlock.classList.remove('hidden')
    showError(err.message)
  }

  render()
})

function render() {
  chrome.storage.local.get(['connected', 'status', 'song', 'meaning', 'deepMeaning'], (data) => {
    statusDot.classList.toggle('live', Boolean(data.connected && data.song))

    if (!data.connected) {
      showOnly(connectView)
      return
    }

    if (!data.song) {
      statusText.textContent = data.status || 'Nothing playing right now'
      showOnly(statusView)
      return
    }

    songTitle.textContent = data.song.title
    songArtist.textContent = data.song.artist
    songLink.href = data.song.spotifyUrl || '#'
    songArt.src = data.song.image || ''
    songArt.style.visibility = data.song.image ? 'visible' : 'hidden'
    eq.classList.toggle('hidden', !data.song.isPlaying)

    if (data.meaning) {
      meaningText.textContent = data.meaning.meaning
      meaningDetail.textContent = data.meaning.detail
      meaningThemes.innerHTML = ''
      ;(data.meaning.themes || []).forEach((theme) => {
        const span = document.createElement('span')
        span.textContent = theme
        meaningThemes.appendChild(span)
      })
      meaningBlock.classList.remove('hidden')
      meaningLoading.classList.add('hidden')
      explainBlock.classList.add('hidden')

      if (data.deepMeaning && typeof data.deepMeaning.deepDive === 'string') {
        deepText.innerHTML = ''
        data.deepMeaning.deepDive
          .split('\n\n')
          .filter(Boolean)
          .forEach((paragraph) => {
            const p = document.createElement('p')
            p.textContent = paragraph
            deepText.appendChild(p)
          })
        deepBlock.classList.remove('hidden')
        deeperBlock.classList.add('hidden')
        deepLoading.classList.add('hidden')
      } else {
        if (data.deepMeaning) {
          chrome.storage.local.remove('deepMeaning')
        }
        deepBlock.classList.add('hidden')
        deeperBlock.classList.remove('hidden')
      }
    } else {
      meaningBlock.classList.add('hidden')
      meaningLoading.classList.add('hidden')
      explainBlock.classList.remove('hidden')
    }

    showOnly(songView)
  })
}

render()
chrome.storage.onChanged.addListener(render)