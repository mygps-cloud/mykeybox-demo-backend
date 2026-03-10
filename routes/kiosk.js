const express = require('express')
const router = express.Router()
const { getDb } = require('../db/setup')

module.exports = function (driver) {

    // Validate code (D only) — check if code is available before showing car/door selection
    router.post('/validate-code', (req, res) => {
        const { type, code } = req.body
        if (!type || !code) return res.json({ success: false, message: 'Type and code required' })
        if (!['C', 'S', 'D'].includes(type.toUpperCase()))
            return res.json({ success: false, message: 'Invalid type' })
        if (code.length !== 5 || !/^\d{5}$/.test(code))
            return res.json({ success: false, message: 'Code must be 5 digits' })

        const db = getDb()
        const upperType = type.toUpperCase()

        if (upperType === 'D') {
            // Dealer — check code isn't already in use
            const existing = db.prepare("SELECT * FROM key_slots WHERE code = ? AND status = 'occupied'").get(code)
            if (existing) {
                return res.json({ success: false, message: 'Code already in use' })
            }
            // Check if there are empty doors
            const emptyCount = db.prepare("SELECT COUNT(*) as count FROM key_slots WHERE status = 'empty'").get()
            if (emptyCount.count === 0) {
                return res.json({ success: false, message: 'No empty doors available' })
            }
            res.json({ success: true, action: 'place' })
        } else {
            // C/S — find door with this code and open it
            const slot = db.prepare("SELECT * FROM key_slots WHERE code = ? AND status = 'occupied'").get(code)
            if (!slot) {
                return res.json({ success: false, message: 'Code not found' })
            }

            // Open the door
            const opened = driver.openDoor(slot.door_number - 1)
            if (!opened) return res.json({ success: false, message: 'Failed to open door' })

            // Clear the code — door becomes empty
            const carInfo = slot.label || ''
            const carVin = slot.vin || ''
            db.prepare("UPDATE key_slots SET status = 'empty', code = NULL, code_type = NULL, label = NULL, vin = NULL, checked_out_by = NULL, checked_out_at = NULL WHERE id = ?")
                .run(slot.id)

            // Audit
            db.prepare('INSERT INTO audit_log (user_name, key_slot_id, door_number, action, details) VALUES (?, ?, ?, ?, ?)')
                .run(`${upperType === 'C' ? 'Carrier' : 'Service'} (${upperType})`, slot.id, slot.door_number, 'retrieve_key', `Code: ${upperType}-${code} | ${carInfo} | ${carVin}`)

            console.log(`[KIOSK] ${upperType}-${code} → Door ${slot.door_number} RETRIEVED (${carInfo})`)

            res.json({
                success: true,
                action: 'retrieve',
                door_number: slot.door_number,
                car_label: carInfo,
                car_vin: carVin,
                message: `Door ${slot.door_number} is open — take the key`
            })
        }
    })

    // Place key (D only) — dealer chose car + door, now open it
    router.post('/place-key', (req, res) => {
        const { code, door_number, car_label, car_vin } = req.body
        if (!code || !door_number) return res.json({ success: false, message: 'Code and door required' })

        const db = getDb()

        // Verify code isn't taken
        const existing = db.prepare("SELECT * FROM key_slots WHERE code = ? AND status = 'occupied'").get(code)
        if (existing) return res.json({ success: false, message: 'Code already in use' })

        // Verify door is empty
        const slot = db.prepare("SELECT * FROM key_slots WHERE door_number = ? AND status = 'empty'").get(door_number)
        if (!slot) return res.json({ success: false, message: 'Door not available' })

        // Open the door
        const opened = driver.openDoor(slot.door_number - 1)
        if (!opened) return res.json({ success: false, message: 'Failed to open door' })

        // Save code + car info
        db.prepare("UPDATE key_slots SET status = 'occupied', code = ?, code_type = 'D', label = ?, vin = ?, checked_out_at = datetime('now') WHERE id = ?")
            .run(code, car_label || null, car_vin || null, slot.id)

        // Audit
        db.prepare('INSERT INTO audit_log (user_name, key_slot_id, door_number, action, details) VALUES (?, ?, ?, ?, ?)')
            .run('Dealer (D)', slot.id, slot.door_number, 'place_key', `Code: D-${code} | ${car_label || ''} | ${car_vin || ''}`)

        console.log(`[KIOSK] D-${code} → Door ${slot.door_number} PLACED (${car_label})`)

        res.json({
            success: true,
            action: 'place',
            door_number: slot.door_number,
            message: `Door ${slot.door_number} is open — place the key`
        })
    })

    // Get all slots with current status (for welcome screen + door selection)
    router.get('/slots', (req, res) => {
        const db = getDb()
        const slots = db.prepare('SELECT id, door_number, label, vin, status, code FROM key_slots ORDER BY door_number').all()
        res.json({ slots })
    })

    // Live door states from hardware
    router.get('/door-states', (req, res) => {
        res.json({
            states: driver.getDoorStates(),
            connected: driver.isConnected()
        })
    })

    return router
}
