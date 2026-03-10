const { execFile } = require('child_process')

const PATTERNS = {
    doorOpen: [
        { freq: 2500, duration: 200 },
        { pause: 100 },
        { freq: 2500, duration: 200 },
    ],
    doorClosed: [
        { freq: 1500, duration: 250 },
    ],
    error: [
        { freq: 3000, duration: 100 },
        { pause: 80 },
        { freq: 3000, duration: 100 },
        { pause: 80 },
        { freq: 3000, duration: 100 },
    ],
    success: [
        { freq: 2000, duration: 200 },
        { pause: 50 },
        { freq: 2500, duration: 200 },
    ],
}

const REPEAT_INTERVAL = 2000
const _activeAlarms = {} // doorIndex → intervalId

function beep(freq, durationMs) {
    return new Promise((resolve) => {
        // Try 'beep' first (pcspkr), fall back to speaker-test (ALSA)
        execFile('beep', ['-f', String(freq), '-l', String(durationMs)], (err) => {
            if (err) {
                // Fallback: speaker-test generates sine wave through ALSA
                const durationSec = Math.max(durationMs / 1000, 0.1)
                const child = execFile('speaker-test', [
                    '-t', 'sine', '-f', String(freq),
                    '-l', '1', '-p', String(durationSec)
                ], { timeout: durationMs + 500 }, () => resolve())
                // Kill after duration
                setTimeout(() => { try { child.kill() } catch(e) {} }, durationMs + 100)
                return
            }
            resolve()
        })
    })
}

async function play(patternName) {
    const pattern = PATTERNS[patternName]
    if (!pattern) return
    try {
        for (const step of pattern) {
            if (step.pause) {
                await new Promise(r => setTimeout(r, step.pause))
            } else {
                await beep(step.freq, step.duration)
            }
        }
    } catch (err) {
        console.error('[BUZZER] play failed:', err.message)
    }
}

function startDoorAlarm(doorIndex) {
    if (_activeAlarms[doorIndex]) return
    console.log(`[BUZZER] Door ${doorIndex + 1} alarm ON`)
    play('doorOpen')
    _activeAlarms[doorIndex] = setInterval(() => play('doorOpen'), REPEAT_INTERVAL)
}

function stopDoorAlarm(doorIndex) {
    if (!_activeAlarms[doorIndex]) return
    clearInterval(_activeAlarms[doorIndex])
    delete _activeAlarms[doorIndex]
    console.log(`[BUZZER] Door ${doorIndex + 1} alarm OFF`)
    play('doorClosed')
}

module.exports = { beep, play, startDoorAlarm, stopDoorAlarm, PATTERNS }
