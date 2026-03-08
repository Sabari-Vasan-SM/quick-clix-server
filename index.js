require('dotenv').config({ quiet: true });

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
    port: toInt(process.env.PORT, 5000),
    ttlMs: toInt(process.env.TTL_MINUTES, 15) * 60 * 1000,
    maxFileBytes: toInt(process.env.MAX_FILE_MB, 25) * 1024 * 1024,
    maxTextLength: toInt(process.env.MAX_TEXT_LENGTH, 20000),
    maxEntries: toInt(process.env.MAX_ACTIVE_ITEMS, 4000),
    cleanupMs: toInt(process.env.CLEANUP_INTERVAL_SECONDS, 60) * 1000,
    corsOrigins: (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
};

const clipboardStore = new Map();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.maxFileBytes,
        files: 1,
    },
});

function generatePin() {
    return Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
}

function isValidPin(pin) {
    return /^\d{4}$/.test(pin);
}

function isExpired(entry) {
    return Date.now() > entry.expiresAt;
}

function buildExpiresAt() {
    return Date.now() + config.ttlMs;
}

function sanitizeFileName(fileName) {
    return String(fileName || 'file')
        .replace(/[\r\n]/g, '')
        .replace(/"/g, "'")
        .slice(0, 120);
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

function generateUniquePin() {
    if (clipboardStore.size >= config.maxEntries) {
        return null;
    }

    for (let i = 0; i < 10000; i += 1) {
        const pin = generatePin();
        if (!clipboardStore.has(pin)) {
            return pin;
        }
    }

    return null;
}

const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [pin, entry] of clipboardStore.entries()) {
        if (entry.expiresAt <= now) {
            clipboardStore.delete(pin);
        }
    }
}, config.cleanupMs);

cleanupTimer.unref();

const corsOptions = {
    origin(origin, callback) {
        if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origin not allowed by CORS'));
    },
};

const baseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: toInt(process.env.RATE_LIMIT_GENERAL, 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: toInt(process.env.RATE_LIMIT_UPLOAD, 80),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Upload limit reached. Please wait and try again.' },
});

const retrieveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: toInt(process.env.RATE_LIMIT_RETRIEVE, 240),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Retrieve limit reached. Please wait and try again.' },
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '250kb' }));
app.use(baseLimiter);

app.get('/health', (_req, res) => {
    return res.status(200).json({
        ok: true,
        uptimeSeconds: process.uptime(),
        activeItems: clipboardStore.size,
    });
});

app.post('/api/clipboard', uploadLimiter, upload.single('file'), (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const file = req.file;
    const hasText = text.length > 0;
    const hasFile = Boolean(file);

    if ((hasText && hasFile) || (!hasText && !hasFile)) {
        return res.status(400).json({ message: 'Upload either text or a file.' });
    }

    if (hasText && text.length > config.maxTextLength) {
        return res
            .status(400)
            .json({ message: `Text must be ${config.maxTextLength} characters or fewer.` });
    }

    const pin = generateUniquePin();
    if (!pin) {
        return res.status(503).json({
            message: 'Clipboard is currently at capacity. Please try again shortly.',
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
            fileName: sanitizeFileName(file.originalname),
            mimeType: file.mimetype || 'application/octet-stream',
            size: file.size,
            downloadToken: null,
            expiresAt,
        });
    }

    return res.status(201).json({ pin, expiresAt });
});

app.post('/api/clipboard/retrieve', retrieveLimiter, (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';

    if (!isValidPin(pin)) {
        return res.status(400).json({ message: 'PIN must be exactly 4 digits.' });
    }

    const entry = clipboardStore.get(pin);
    if (removeIfExpired(pin, entry)) {
        return res.status(404).json({ message: 'PIN is invalid or has expired.' });
    }

    if (entry.kind === 'text') {
        clipboardStore.delete(pin);
        return res.status(200).json({ kind: 'text', text: entry.text });
    }

    const downloadToken = crypto.randomBytes(18).toString('hex');
    entry.downloadToken = downloadToken;
    clipboardStore.set(pin, entry);

    return res.status(200).json({
        kind: 'file',
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        size: entry.size,
        downloadPath: `/api/clipboard/download/${pin}?token=${downloadToken}`,
    });
});

app.get('/api/clipboard/download/:pin', retrieveLimiter, (req, res) => {
    const pin = req.params.pin;
    const token = typeof req.query?.token === 'string' ? req.query.token : '';

    if (!isValidPin(pin)) {
        return res.status(400).json({ message: 'PIN must be exactly 4 digits.' });
    }

    const entry = clipboardStore.get(pin);
    if (removeIfExpired(pin, entry)) {
        return res.status(404).json({ message: 'PIN is invalid or has expired.' });
    }

    if (entry.kind !== 'file') {
        return res.status(400).json({ message: 'PIN does not contain a file.' });
    }

    if (!token || token !== entry.downloadToken) {
        return res.status(403).json({ message: 'Download token is invalid.' });
    }

    clipboardStore.delete(pin);

    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${entry.fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.status(200).send(entry.fileBuffer);
});

app.use((error, _req, res, _next) => {
    if (error?.message === 'Origin not allowed by CORS') {
        return res.status(403).json({ message: 'Request origin is not allowed.' });
    }

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                message: `File exceeds maximum size of ${config.maxFileBytes / (1024 * 1024)} MB.`,
            });
        }

        return res.status(400).json({ message: 'Invalid upload request.' });
    }

    console.error('Unhandled server error:', error);
    return res.status(500).json({ message: 'Something went wrong.' });
});

const clientDistPath = path.join(__dirname, '..', 'quick-clix-client', 'dist');
const fs = require('fs');
if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });
}

app.listen(config.port, () => {
    console.log(`Quick Clix API running on http://localhost:${config.port}`);
});
