const express = require('express')
const path = require('path')
const config = require('./config')
const { getDb } = require('./db/setup')
const buzzer = require('./buzzer')

const app = express()
app.use(express.json())

// ── Serve Frontend ─────────────────────────────────

app.use('/kiosk', express.static(path.join(__dirname, 'views', 'kiosk')))
app.use('/admin', express.static(path.join(__dirname, 'views', 'admin')))
app.get('/', (req, res) => res.redirect('/kiosk'))

// ── Start ──────────────────────────────────────────

async function start() {
    // Initialize database
    getDb()
    console.log(`[DB] SQLite ready`)

    // Initialize hardware driver
    let driver
    switch (config.DRIVER) {
        case 'cu48': {
            const CU48Driver = require('./drivers/cu48')
            driver = new CU48Driver(config.DOOR_COUNT, config.SERIAL_PORT, config.BAUD_RATE)
            break
        }
        case 'modbus': {
            console.log('[WARN] MODBUS driver not yet implemented, falling back to simulator')
            const SimulatorDriver = require('./drivers/simulator')
            driver = new SimulatorDriver(config.DOOR_COUNT)
            break
        }
        default: {
            const SimulatorDriver = require('./drivers/simulator')
            driver = new SimulatorDriver(config.DOOR_COUNT)
        }
    }
    await driver.initialize()
    console.log(`[DRIVER] ${config.DRIVER} initialized (${config.DOOR_COUNT} doors)`)

    // ── Buzzer: alarm on door open, stop on close ──
    if (driver.onDoorChange !== undefined || config.DRIVER === 'cu48') {
        driver.onDoorChange = (doorIndex, isClosed) => {
            if (isClosed) {
                buzzer.stopDoorAlarm(doorIndex)
            } else {
                buzzer.startDoorAlarm(doorIndex)
            }
        }
        console.log('[BUZZER] Door alarm integration active')
    }

    // Register API routes (driver is now ready)
    app.use('/api/kiosk', require('./routes/kiosk')(driver))
    app.use('/api/admin', require('./routes/admin')(driver))

    app.get('/api/health', (req, res) => {
        res.json({
            device: config.DEVICE_NAME,
            driver: config.DRIVER,
            doors: config.DOOR_COUNT,
            connected: driver.isConnected(),
            door_states: driver.getDoorStates(),
            uptime: process.uptime()
        })
    })

    // ── Beep test endpoint ──
    app.get('/api/beep', async (req, res) => {
        const { pattern, freq, duration } = req.query
        if (pattern) {
            await buzzer.play(pattern)
            return res.json({ ok: true, pattern })
        }
        if (freq) {
            await buzzer.beep(parseInt(freq) || 1000, parseInt(duration) || 500)
            return res.json({ ok: true, freq, duration })
        }
        res.json({ patterns: Object.keys(buzzer.PATTERNS) })
    })

    app.listen(config.PORT, '0.0.0.0', () => {
        console.log(`\n  MyKeyBox Demo - ${config.DEVICE_NAME}`)
        console.log(`  ─────────────────────────────────`)
        console.log(`  Kiosk:  http://localhost:${config.PORT}/kiosk`)
        console.log(`  Admin:  http://localhost:${config.PORT}/admin`)
        console.log(`  API:    http://localhost:${config.PORT}/api/health`)
        console.log(`  Driver: ${config.DRIVER} (${config.DOOR_COUNT} doors)`)
        console.log(`  ─────────────────────────────────\n`)
    })
}

start().catch(err => {
    console.error('Failed to start:', err)
    process.exit(1)
})
