module.exports = {
    PORT: 14141,
    DEVICE_NAME: process.env.DEVICE_NAME || 'DEMO-1',

    // Driver: 'simulator' | 'cu48' | 'modbus'
    DRIVER: process.env.DRIVER || 'cu48',
    DOOR_COUNT: parseInt(process.env.DOOR_COUNT || '4'),

    // Serial config (for cu48/modbus drivers)
    SERIAL_PORT: process.env.SERIAL_PORT || '/dev/ttyUSB0',
    BAUD_RATE: parseInt(process.env.BAUD_RATE || '19200'),

    // Mode: 'internal' | 'handoff' | 'general'
    // Can also be set via admin panel (stored in DB)
    DEFAULT_MODE: process.env.MODE || 'internal',

    // Kiosk UI timeout (seconds)
    INACTIVITY_TIMEOUT: 90,
    DOOR_OPEN_TIMEOUT: 30,
}
