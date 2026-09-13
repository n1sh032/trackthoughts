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

const progressSection = document.getElementById('progress-section')
const progressBar = document.getElementById('progress-bar')
const elapsedLabel = document.getElementById('elapsed-label')
const durationLabel = document.getElementById('duration-label')
const volumeSection = document.getElementById('volume-section')
const volumeSlider = document.getElementById('volume-slider')

const tabMeaningButton = document.getElementById('tab-meaning')
const tabLyricsButton = document.getElementById('tab-lyrics')
const meaningPanel = document.getElementById('meaning-panel')
const lyricsPanel = document.getElementById('lyrics-panel')
const lyricsList = document.getElementById('lyrics-list')

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

tabMeaningButton.addEventListener('click', () => switchTab('meaning'))
tabLyricsButton.addEventListener('click', () => switchTab('lyrics'))

function switchTab(tab) {
  meaningPanel.classList.toggle('hidden', tab !== 'meaning')
  lyricsPanel.classList.toggle('hidden', tab !== 'lyrics')
  tabMeaningButton.classList.toggle('active', tab === 'meaning')
  tabLyricsButton.classList.toggle('active', tab === 'lyrics')
}

// ---------- live player: progress bar, volume, synced lyrics ----------
// this talks directly to the server (not through background.js) so it
// works reliably while the popup is open, with no message-port issues

let isSeekingProgress = false
let lyricsLines = null
let lyricsForTrackId = null
let activeLyricIndex = -1

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function updateRangeFill(input) {
  const min = Number(input.min) || 0
  const max = Number(input.max) || 100
  const value = Number(input.value)
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0
  input.style.background = `linear-gradient(to right, #b7ff3c ${percent}%, #4a4a4a ${percent}%)`
}

async function pollPlayerState() {
  try {
    const response = await fetch(`${API_BASE}/api/player-state`)
    const data = await response.json()

    if (!response.ok || !data.title) {
      progressSection.classList.add('hidden')
      volumeSection.classList.add('hidden')
      return
    }

    progressSection.classList.remove('hidden')
    elapsedLabel.textContent = formatTime(data.progressMs)
    durationLabel.textContent = formatTime(data.durationMs)

    if (!isSeekingProgress) {
      progressBar.max = data.durationMs || 0
      progressBar.value = data.progressMs || 0
      updateRangeFill(progressBar)
    }

    if (data.volumePercent !== null && data.volumePercent !== undefined) {
      volumeSection.classList.remove('hidden')
      if (document.activeElement !== volumeSlider) {
        volumeSlider.value = data.volumePercent
        updateRangeFill(volumeSlider)
      }
    } else {
      volumeSection.classList.add('hidden')
    }

    if (data.trackId !== lyricsForTrackId) {
      lyricsForTrackId = data.trackId
      lyricsLines = null
      activeLyricIndex = -1
      loadLyrics(data.title, data.artist, data.durationMs)
    }

    highlightLyricAt(data.progressMs)
  } catch (err) {
    // server unreachable - connection state is already surfaced elsewhere
  }
}

progressBar.addEventListener('input', () => {
  isSeekingProgress = true
  elapsedLabel.textContent = formatTime(Number(progressBar.value))
  updateRangeFill(progressBar)
})

progressBar.addEventListener('change', async () => {
  const positionMs = Math.round(Number(progressBar.value))
  isSeekingProgress = false
  try {
    await fetch(`${API_BASE}/api/player/seek?positionMs=${positionMs}`, { method: 'PUT' })
  } catch (err) {
    // next poll resyncs the real position
  }
})

let volumeDebounce = null
volumeSlider.addEventListener('input', () => {
  updateRangeFill(volumeSlider)
  clearTimeout(volumeDebounce)
  const percent = Math.round(Number(volumeSlider.value))
  volumeDebounce = setTimeout(async () => {
    try {
      await fetch(`${API_BASE}/api/player/volume?percent=${percent}`, { method: 'PUT' })
    } catch (err) {
      // ignore
    }
  }, 250)
})

async function loadLyrics(title, artist, durationMs) {
  lyricsList.innerHTML = '<p class="lyrics-empty">Loading lyrics...</p>'
  try {
    const response = await fetch(
      `${API_BASE}/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&durationMs=${durationMs || ''}`
    )
    const data = await response.json()

    if (!response.ok || !data.lines) {
      lyricsLines = null
      lyricsList.innerHTML = `<p class="lyrics-empty">${data.message || 'No synced lyrics found for this song.'}</p>`
      return
    }

    lyricsLines = data.lines
    renderLyrics()
  } catch (err) {
    lyricsLines = null
    lyricsList.innerHTML = '<p class="lyrics-empty">Could not load lyrics right now.</p>'
  }
}

function renderLyrics() {
  lyricsList.innerHTML = ''
  lyricsLines.forEach((line, index) => {
    const p = document.createElement('p')
    p.className = 'lyric-line'
    p.textContent = line.text
    p.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/api/player/seek?positionMs=${line.timeMs}`, { method: 'PUT' })
        progressBar.value = line.timeMs
        updateRangeFill(progressBar)
        elapsedLabel.textContent = formatTime(line.timeMs)
      } catch (err) {
        // ignore
      }
    })
    lyricsList.appendChild(p)
  })
  activeLyricIndex = -1
}

function highlightLyricAt(progressMs) {
  if (!lyricsLines || lyricsLines.length === 0) return

  let newIndex = -1
  for (let i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].timeMs <= progressMs) {
      newIndex = i
    } else {
      break
    }
  }

  if (newIndex === activeLyricIndex) return
  activeLyricIndex = newIndex

  const children = lyricsList.querySelectorAll('.lyric-line')
  children.forEach((el) => el.classList.remove('active'))
  if (newIndex >= 0 && children[newIndex]) {
    children[newIndex].classList.add('active')
    children[newIndex].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

setInterval(pollPlayerState, 1000)
pollPlayerState()

// ---------- existing meaning/deep-dive rendering (unchanged) ----------

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