const BaseDriver = require('./base')

// CU48 commands for up to 48 doors
// Query: 02 00 00 50 03 55
// Open door N: 02 00 [N] 51 03 [checksum]
// Response: 02 00 00 65 [D1][D2][D3][D4][D5][D6] 03 [checksum] (12 bytes)

class CU48Driver extends BaseDriver {
    constructor(doorCount, serialPort, baudRate) {
        super(doorCount)
        this.serialPortPath = serialPort
        this.baudRate = baudRate
        this.port = null
        this.parser = null
        this.lastResponseTime = 0
        this._openingDoors = new Set()
    }

    async initialize() {
        this._connect()

        // Auto-reconnect every 5 seconds if disconnected
        this._reconnectInterval = setInterval(() => {
            if (!this.port || !this.port.isOpen || !this._isDeviceUp()) {
                console.log('[CU48] Reconnecting...')
                this._cleanup()
                this._connect()
            }
        }, 5000)

        // Poll door states every 1 second
        this._pollInterval = setInterval(() => {
            if (this.port && this.port.isOpen && this._isDeviceUp()) {
                this._sendQuery()
            }
        }, 1000)
    }

    _connect() {
        try {
            const { SerialPort } = require('serialport')
            const { ByteLengthParser } = require('@serialport/parser-byte-length')

            this.port = new SerialPort({ path: this.serialPortPath, baudRate: this.baudRate })
            this.parser = this.port.pipe(new ByteLengthParser({ length: 12 }))

            this.parser.on('data', (data) => {
                this._parseResponse(data)
            })

            this.port.on('error', (err) => {
                console.log('[CU48] Serial error:', err.message)
                this.connected = false
            })

            this.port.on('open', () => {
                this.connected = true
                console.log(`[CU48] Connected on ${this.serialPortPath} @ ${this.baudRate}`)
                this._sendQuery()
            })

        } catch (err) {
            console.log('[CU48] Failed to connect:', err.message)
            this.connected = false
        }
    }

    _cleanup() {
        try {
            if (this.port && this.port.isOpen) this.port.close()
        } catch (e) { /* ignore */ }
        this.port = null
        this.parser = null
        this.lastResponseTime = 0
        this.connected = false
    }

    _isDeviceUp(timeout = 2500) {
        return this.lastResponseTime + timeout > Date.now()
    }

    _sendQuery() {
        // Query all 48 locks: 02 00 00 50 03 55
        if (this.port && this.port.isOpen) {
            const buf = Buffer.from([0x02, 0x00, 0x00, 0x50, 0x03, 0x55])
            this.port.write(buf)
        }
    }

    _parseResponse(data) {
        const hex = data.toString('hex')
        const pairs = hex.match(/.{1,2}/g)
        if (pairs[0] !== '02' || pairs[10] !== '03') {
            console.log('[CU48] Bad frame:', hex)
            return
        }

        this.lastResponseTime = Date.now()
        this.connected = true

        // Parse 6 data bytes (D1-D6) → 48 lock states
        const prevStates = [...this.doorStates]
        for (let byteIdx = 4; byteIdx <= 9; byteIdx++) {
            const b = parseInt(pairs[byteIdx], 16)
            for (let bit = 0; bit < 8; bit++) {
                const doorIdx = (byteIdx - 4) * 8 + bit
                if (doorIdx < this.doorCount) {
                    this.doorStates[doorIdx] = ((b >> bit) & 1) === 1
                }
            }
        }

        // Detect and log state changes
        for (let i = 0; i < this.doorCount; i++) {
            if (prevStates[i] !== this.doorStates[i]) {
                const state = this.doorStates[i] ? 'CLOSED' : 'OPEN'
                console.log(`[CU48] Door ${i + 1} → ${state}`)
                if (this.onDoorChange) {
                    this.onDoorChange(i, this.doorStates[i])
                }
            }
        }
    }

    async openDoor(doorNumber) {
        if (!this.port || !this.port.isOpen) {
            console.log(`[CU48] Door ${doorNumber + 1} FAILED — serial not connected`)
            return false
        }
        if (!this._isDeviceUp()) {
            console.log(`[CU48] Door ${doorNumber + 1} FAILED — hardware not responding`)
            return false
        }
        if (doorNumber < 0 || doorNumber >= this.doorCount) {
            console.log(`[CU48] Door ${doorNumber + 1} FAILED — invalid door number`)
            return false
        }

        // Prevent double-triggering
        if (this._openingDoors.has(doorNumber)) {
            console.log(`[CU48] Door ${doorNumber + 1} skipped — already opening`)
            return true
        }
        this._openingDoors.add(doorNumber)

        // Open command: 02 00 [doorNumber] 51 03 [checksum]
        const checksum = (0x02 + 0x00 + doorNumber + 0x51 + 0x03) & 0xFF
        const buf = Buffer.from([0x02, 0x00, doorNumber, 0x51, 0x03, checksum])

        console.log(`[CU48] Opening door ${doorNumber + 1}: ${buf.toString('hex')}`)
        this.port.write(buf)
        this._sendQuery()

        // Poll for confirmation: every 200ms, max 10 retries (2 seconds)
        const maxRetries = 10
        let retryCount = 0
        let noResponseCount = 0
        const lastResponse = this.lastResponseTime

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                retryCount++
                const isOpen = !this.doorStates[doorNumber]

                if (isOpen) {
                    console.log(`[CU48] Door ${doorNumber + 1} confirmed OPEN after ${retryCount * 200}ms`)
                    clearInterval(interval)
                    this._openingDoors.delete(doorNumber)
                    resolve(true)
                    return
                }

                // Check if hardware is responding
                if (this.lastResponseTime === lastResponse) {
                    noResponseCount++
                } else {
                    noResponseCount = 0
                }

                if (noResponseCount >= 5) {
                    console.log(`[CU48] Door ${doorNumber + 1} FAILSAFE — no CU48 response, aborting`)
                    clearInterval(interval)
                    this._openingDoors.delete(doorNumber)
                    resolve(false)
                    return
                }

                if (retryCount >= maxRetries) {
                    console.log(`[CU48] Door ${doorNumber + 1} gave up after ${maxRetries * 200}ms`)
                    clearInterval(interval)
                    this._openingDoors.delete(doorNumber)
                    resolve(true) // command was sent, may still open
                    return
                }

                // Resend open + query
                this.port.write(buf)
                this._sendQuery()
            }, 200)
        })
    }

    async close() {
        if (this._pollInterval) clearInterval(this._pollInterval)
        if (this._reconnectInterval) clearInterval(this._reconnectInterval)
        this._cleanup()
    }
}

module.exports = CU48Driver
