const API_BASE = 'http://127.0.0.1:3000'

const connectView = document.getElementById('connect-view')
const statusView = document.getElementById('status-view')
const songView = document.getElementById('song-view')
const statusText = document.getElementById('status-text')

const songArt = document.getElementById('song-art')
const songTitle = document.getElementById('song-title')
const songArtist = document.getElementById('song-artist')
const songLink = document.getElementById('song-link')

const meaningBlock = document.getElementById('meaning-block')
const meaningText = document.getElementById('meaning-text')
const meaningDetail = document.getElementById('meaning-detail')
const meaningThemes = document.getElementById('meaning-themes')
const meaningLoading = document.getElementById('meaning-loading')

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

function render() {
  chrome.storage.local.get(['connected', 'status', 'song', 'meaning'], (data) => {
    if (!data.connected) {
      showOnly(connectView)
      return
    }

    if (!data.song) {
      statusText.textContent = data.status || 'nothing is playing right now'
      showOnly(statusView)
      return
    }

    songTitle.textContent = data.song.title
    songArtist.textContent = data.song.artist
    songLink.href = data.song.spotifyUrl || '#'
    if (data.song.image) {
      songArt.src = data.song.image
      songArt.classList.remove('hidden')
    } else {
      songArt.classList.add('hidden')
    }

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
    } else {
      meaningBlock.classList.add('hidden')
      meaningLoading.classList.remove('hidden')
    }

    showOnly(songView)
  })
}

render()
chrome.storage.onChanged.addListener(render)