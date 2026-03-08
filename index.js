const express = require('express');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;
const TTL_MS = 15 * 60 * 1000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const clipboardStore = new Map();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_BYTES,
    },
});

function generatePin() {
    return Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
}

function generateUniquePin() {
    for (let i = 0; i < 10000; i += 1) {
        const pin = generatePin();
        if (!clipboardStore.has(pin)) {
            return pin;
        }
    }

    return null;
}

function isValidPin(pin) {
    return /^\d{4}$/.test(pin);
}

function isExpired(entry) {
    return Date.now() > entry.expiresAt;
}

function removeIfExpired(pin, entry) {
    if (!entry) {
        return true;
    }

    if (isExpired(entry)) {
        clipboardStore.delete(pin);
        return true;
    }

    return false;
}

function buildExpiresAt() {
    return Date.now() + TTL_MS;
}

setInterval(() => {
    const now = Date.now();

    for (const [pin, entry] of clipboardStore.entries()) {
        if (entry.expiresAt <= now) {
            clipboardStore.delete(pin);
        }
    }
}, 60 * 1000);

app.post('/api/clipboard', upload.single('file'), (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const file = req.file;

    const hasText = text.length > 0;
    const hasFile = Boolean(file);

    if ((hasText && hasFile) || (!hasText && !hasFile)) {
        return res.status(400).json({
            message: 'Upload either text or a file.',
        });
    }

    if (hasText && text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({
            message: `Text must be ${MAX_TEXT_LENGTH} characters or fewer.`,
        });
    }

    const pin = generateUniquePin();
    if (!pin) {
        return res.status(503).json({
            message: 'Temporary storage is full. Please try again shortly.',
        });
    }

    const expiresAt = buildExpiresAt();

    if (hasText) {
        clipboardStore.set(pin, {
            kind: 'text',
            text,
            expiresAt,
        });
    } else {
        clipboardStore.set(pin, {
            kind: 'file',
            fileBuffer: file.buffer,
            fileName: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            size: file.size,
            expiresAt,
        });
    }

    return res.status(201).json({
        pin,
        expiresAt,
    });
});

app.post('/api/clipboard/retrieve', (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';

    if (!isValidPin(pin)) {
        return res.status(400).json({
            message: 'PIN must be exactly 4 digits.',
        });
    }

    const entry = clipboardStore.get(pin);
    if (removeIfExpired(pin, entry)) {
        return res.status(404).json({
            message: 'PIN is invalid or has expired.',
        });
    }

    if (entry.kind === 'text') {
        clipboardStore.delete(pin);

        return res.status(200).json({
            kind: 'text',
            text: entry.text,
        });
    }

    return res.status(200).json({
        kind: 'file',
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        size: entry.size,
        downloadPath: `/api/clipboard/download/${pin}`,
    });
});

app.get('/api/clipboard/download/:pin', (req, res) => {
    const pin = req.params.pin;

    if (!isValidPin(pin)) {
        return res.status(400).json({
            message: 'PIN must be exactly 4 digits.',
        });
    }

    const entry = clipboardStore.get(pin);
    if (removeIfExpired(pin, entry)) {
        return res.status(404).json({
            message: 'PIN is invalid or has expired.',
        });
    }

    if (entry.kind !== 'file') {
        return res.status(400).json({
            message: 'PIN does not contain a file.',
        });
    }

    clipboardStore.delete(pin);

    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${entry.fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.status(200).send(entry.fileBuffer);
});

app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                message: `File exceeds maximum size of ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
            });
        }

        return res.status(400).json({
            message: 'Invalid upload request.',
        });
    }

    return res.status(500).json({
        message: 'Something went wrong.',
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
