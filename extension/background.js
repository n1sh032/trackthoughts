const API_BASE = 'http://127.0.0.1:3000'
const ALARM_NAME = 'trackthoughts-poll'

const NOTIFICATION_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABSElEQVR4nO2ayxHCMAxERYY2SDnQAFQJDZByoBC4oJng+CPFiiUZ9sgk1lutbYIJgHPtJAc73M8vynXP002sbvVAVOiUas2svrkWPNRaI+ybpMFDcY0MnIu3hl9Tg+S2BXhMlDSKCWjBU2tnDWjCUxmSBizAo3Is+62LP47X6OfjdBEZP5qApe6jUkwLAxbhUTE21veARX0ZsNx9VMjYTwIeuo+as/aTgFcNAL6mDwqZ+0jAs/4GtCX+NJp6+txKogm0hgcQNKABDyBkQAseQMCAJjzAx4DkWWUrIbP7bbQfA56m0Zy1OgHu8cg4XcSOVAACA2tToAJJgIeMYmugBCfZ9bkWBmrWQgpSCj7GloS19ist1dh+ttFQlrbVHEs2AQsmSgzFKaRpglKbBddqYXOaxlrELdLg1vi9P7pDuX3VICaNlz3c6w2Dx4Nd1os3nwAAAABJRU5ErkJggg=='

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 })
  pollNow()
})

chrome.runtime.onStartup.addListener(() => {
  pollNow()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollNow()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'REFRESH_NOW') {
    pollNow().then(() => sendResponse({ ok: true }))
    return true
  }
})

async function pollNow() {
  try {
    const response = await fetch(`${API_BASE}/api/now`)
    const data = await response.json()

    if (!response.ok) {
      await chrome.storage.local.set({
        connected: response.status !== 401,
        status: data.message || 'something went wrong',
        song: null,
        meaning: null,
      })
      updateBadge(false)
      return
    }

    if (!data.song) {
      await chrome.storage.local.set({
        connected: true,
        status: data.message || 'nothing is playing right now',
        song: null,
        meaning: null,
      })
      updateBadge(false)
      return
    }

    const { song, meaning } = data
    const stored = await chrome.storage.local.get(['song'])
    const isNewTrack = stored.song?.trackId !== song.trackId

    await chrome.storage.local.set({
      connected: true,
      status: null,
      song,
      meaning,
    })

    updateBadge(true)

    if (isNewTrack && meaning) {
      chrome.notifications.create(song.trackId, {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON,
        title: `${song.title} — ${song.artist}`,
        message: meaning.meaning,
        priority: 1,
      })
    }
  } catch (err) {
    await chrome.storage.local.set({
      connected: false,
      status: 'could not reach the trackthoughts server. is it running?',
      song: null,
      meaning: null,
    })
    updateBadge(false)
  }
}

function updateBadge(isPlaying) {
  chrome.action.setBadgeText({ text: isPlaying ? '♪' : '' })
  chrome.action.setBadgeBackgroundColor({ color: '#1db954' })
}