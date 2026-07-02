const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');

// Import services
const { generateApplicationPDF } = require('./services/pdfGenerator');
const { bundleDocuments } = require('./services/docBundler');
const { sendApplicationEmail } = require('./services/emailService');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. Render's load balancer)

// Allow the deployed frontend origin (comma-separated list supported); falls back to allow-all if unset
const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
app.use(bodyParser.json());

// ---------------------------------------------------------------------------
// Postgres (Supabase) connection
// ---------------------------------------------------------------------------
const db = new Pool({
    connectionString: process.env.DATABASE_URL, // Supabase gives you this directly
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
});

db.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('PostgreSQL (Supabase) Connected...');
        release();
    }
});

const initDb = async () => {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await db.query(schemaSql);
            console.log('Database schema ensured.');
        }
    } catch (err) {
        console.error('Failed to initialize database schema:', err.message);
    }
};
initDb();

// ---------------------------------------------------------------------------
// Supabase Storage (for uploaded documents)
// ---------------------------------------------------------------------------
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'supabase';

// Validate required environment variables
function validateStorageConfig() {
    if (STORAGE_PROVIDER === 'supabase') {
        if (!process.env.SUPABASE_URL) {
            console.warn('⚠️  SUPABASE_URL is not set!');
        }
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_API_KEY;
        if (!serviceKey || serviceKey === 'your-service-role-key') {
            console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_API_KEY is not set! File uploads will fail.');
        } else {
            console.log('✅ Supabase Service Role Key found');
        }
        console.log(`📦 Storage bucket: ${STORAGE_BUCKET}`);
    } else if (STORAGE_PROVIDER === 's3') {
        const s3Endpoint = process.env.S3_ENDPOINT || process.env.ENDPOINT_URL;
        if (!s3Endpoint) {
            console.warn('⚠️  S3_ENDPOINT / ENDPOINT_URL is not set!');
        }
        const s3AccessKey = process.env.S3_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID;
        if (!s3AccessKey || s3AccessKey === 'your-access-key-id') {
            console.warn('⚠️  S3_ACCESS_KEY_ID / ACCESS_KEY_ID is not set!');
        }
        const s3Secret = process.env.S3_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY;
        if (!s3Secret || s3Secret === 'your-secret-access-key') {
            console.warn('⚠️  S3_SECRET_ACCESS_KEY / SECRET_ACCESS_KEY is not set!');
        }
    }
    console.log(`📦 Storage provider: ${STORAGE_PROVIDER}`);
}

// Initialize storage clients
let supabase = null;
let s3Client = null;

if (STORAGE_PROVIDER === 'supabase') {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_API_KEY // service role key, NOT the anon key - keep this server-side only
    );
} else if (STORAGE_PROVIDER === 's3') {
    s3Client = new S3Client({
        endpoint: process.env.S3_ENDPOINT || process.env.ENDPOINT_URL,
        region: process.env.S3_REGION || process.env.REGION || 'eu-west-1',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY || '',
        },
        forcePathStyle: true,
    });
}

const S3_BUCKET = process.env.S3_BUCKET || STORAGE_BUCKET;

// Validate config on startup
validateStorageConfig();

/**
 * Uploads a buffer to Supabase Storage (bucket should be PRIVATE - these are ID docs / bank statements).
 * Returns the storage path (not a public URL).
 */
async function uploadToSupabaseStorage(buffer, storagePath, mimetype) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_API_KEY;
    if (!serviceKey || serviceKey === 'your-service-role-key') {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_API_KEY is not configured. Please set it in your .env file.');
    }
    
    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType: mimetype, upsert: true });
    if (error) {
        console.error('Supabase storage error:', error);
        throw new Error(`Supabase upload failed: ${error.message}. Make sure the '${STORAGE_BUCKET}' bucket exists and is private.`);
    }
    return storagePath;
}

/**
 * Uploads a buffer to S3-compatible storage (including Supabase Storage via S3 protocol).
 * Returns the storage path (key).
 */
async function uploadToS3Storage(buffer, storagePath, mimetype) {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storagePath,
        Body: buffer,
        ContentType: mimetype,
    });
    try {
        await s3Client.send(command);
        return storagePath;
    } catch (error) {
        console.error('S3 storage error:', error);
        throw new Error(`S3 upload failed: ${error.message}`);
    }
}

/** Generates a short-lived signed URL for a private document (admin use only). */
async function getSignedDocUrl(storagePath, expiresInSeconds = 300) {
    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
    if (error) {
        console.error('Supabase signed URL error:', error);
        throw error;
    }
    return data.signedUrl;
}

/** Generates a short-lived signed URL for S3 storage. */
async function getSignedS3Url(storagePath, expiresInSeconds = 300) {
    const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: storagePath,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

/** Generic upload function that uses the configured storage provider. */
async function uploadToStorage(buffer, storagePath, mimetype) {
    if (STORAGE_PROVIDER === 's3') {
        return await uploadToS3Storage(buffer, storagePath, mimetype);
    }
    return await uploadToSupabaseStorage(buffer, storagePath, mimetype);
}

/** Generic get signed URL function that uses the configured storage provider. */
async function getSignedStorageUrl(storagePath, expiresInSeconds = 300) {
    if (STORAGE_PROVIDER === 's3') {
        return await getSignedS3Url(storagePath, expiresInSeconds);
    }
    return await getSignedDocUrl(storagePath, expiresInSeconds);
}

// Configure Multer to use in-memory storage (buffers, then pushed to Supabase Storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
});

// Simple Admin Credentials
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: ADMIN_TOKEN });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

const docUploadFields = upload.fields([
    { name: 'tag-id', maxCount: 1 },
    { name: 'tag-student-card', maxCount: 1 },
    { name: 'tag-registration', maxCount: 1 },
    { name: 'tag-bank', maxCount: 1 },
    { name: 'tag-selfie', maxCount: 1 },
    { name: 'tag-nsfas', maxCount: 1 },
    { name: 'tag-address', maxCount: 1 }
]);

const applyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { success: false, message: 'Too many applications submitted from this IP. Please try again after an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const validateInput = (data) => {
    const errors = [];
    const requiredFields = [
        'reference_number', 'first_name', 'last_name', 'id_number', 'dob',
        'email', 'cell_phone', 'purpose', 'bank_name', 'acc_num', 'description',
        'guarantor_name', 'guarantor_id', 'guarantor_phone', 'guarantor_rel'
    ];

    requiredFields.forEach(field => {
        if (!data[field] || data[field].toString().trim() === '') {
            errors.push(`${field.replace('_', ' ')} is required.`);
        }
    });

    if (data.id_number && !/^\d{13}$/.test(data.id_number)) {
        errors.push('ID Number must be exactly 13 digits.');
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push('Invalid email format.');
    }
    if (data.popia_consent !== true) {
        errors.push('POPIA consent is required to process this application.');
    }

    return errors;
};

/**
 * Generates the summary PDF, bundles it with the raw file buffers into a ZIP,
 * and emails it — all in memory, no disk writes.
 */
async function processApplicationBundle(appData, fileBuffers) {
    try {
        const pdfBuffer = await generateApplicationPDF(appData);

        // docBundler expects base64 data URLs on appData fields; build a lightweight copy for it
        const bundleData = { ...appData };
        Object.entries(fileBuffers).forEach(([field, file]) => {
            bundleData[field] = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        });

        const zipBuffer = await bundleDocuments(pdfBuffer, bundleData);

        let recipientEmail = null;
        try {
            const settingsResult = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'business_email'");
            if (settingsResult.rows[0]) recipientEmail = settingsResult.rows[0].setting_value;
        } catch (settingsError) {
            console.error('Error fetching business email from settings:', settingsError);
        }

        const emailSent = await sendApplicationEmail(zipBuffer, appData, recipientEmail);
        console.log(emailSent
            ? `Application bundle sent successfully for ${appData.reference_number}`
            : `Failed to send email for ${appData.reference_number}`);
    } catch (error) {
        console.error('Error in processApplicationBundle:', error);
    }
}

app.post('/api/apply', applyLimiter, docUploadFields, async (req, res) => {
    const allowedDataFields = [
        'reference_number', 'first_name', 'last_name', 'id_number', 'dob',
        'email', 'cell_phone', 'purpose', 'bank_name', 'bank_code', 'acc_num', 'acc_type',
        'description', 'guarantor_name', 'guarantor_id', 'guarantor_phone',
        'guarantor_rel', 'popia_consent',
        'loan_amount', 'term_months', 'total_settlement', 'discount_applied'
    ];

    const appData = {};
    allowedDataFields.forEach(field => {
        if (req.body[field] !== undefined) {
            let value = req.body[field];
            if (field === 'popia_consent' || field === 'discount_applied') {
                value = (value === '1' || value === 'true');
            } else if (typeof value === 'string') {
                value = value.trim();
            }
            appData[field] = value;
        }
    });

    const validationErrors = validateInput(appData);
    if (validationErrors.length > 0) {
        return res.status(400).json({ success: false, message: validationErrors[0], errors: validationErrors });
    }

    const fileMap = {
        'tag-id': 'path_id',
        'tag-student-card': 'path_student_card',
        'tag-registration': 'path_registration',
        'tag-bank': 'path_bank_statement',
        'tag-selfie': 'path_selfie',
        'tag-nsfas': 'path_nsfas',
        'tag-address': 'path_address'
    };

    const missingFiles = [];
    const fileBuffers = {}; // keyed by column name, used later for the email bundle
    try {
        console.log('Starting file uploads...');
        for (const field of Object.keys(fileMap)) {
            if (req.files && req.files[field]) {
                const file = req.files[field][0];
                const ext = path.extname(file.originalname) || '';
                const storagePath = `applications/${appData.reference_number}/${fileMap[field]}${ext}`;
                console.log(`Uploading ${field} to ${storagePath}...`);
                await uploadToStorage(file.buffer, storagePath, file.mimetype);
                console.log(`Successfully uploaded ${field}`);
                appData[fileMap[field]] = storagePath; // store the path, bucket is private
                fileBuffers[fileMap[field]] = file;
            } else {
                missingFiles.push(`Document ${field} is required.`);
            }
        }
        console.log('All files uploaded successfully!');
    } catch (uploadErr) {
        console.error('Storage upload error details:', uploadErr);
        console.error('Error message:', uploadErr.message);
        console.error('Error stack:', uploadErr.stack);
        return res.status(500).json({ 
            success: false, 
            message: `File upload failed: ${uploadErr.message}. Please check your Supabase credentials.` 
        });
    }

    if (missingFiles.length > 0) {
        return res.status(400).json({ success: false, message: missingFiles[0], errors: missingFiles });
    }

    const columns = Object.keys(appData);
    const values = Object.values(appData);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders})`;

    try {
        await db.query(sql, values);
        res.send({ success: true, message: 'Application saved' });
        processApplicationBundle(appData, fileBuffers).catch(error => {
            console.error('Error processing application bundle:', error);
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: 'Database error' });
    }
});

app.get('/api/admin/applications', async (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const result = await db.query('SELECT * FROM applications ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// Generates a short-lived signed URL so an admin can view a private document
app.get('/api/admin/document-url', async (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { path: storagePath } = req.query;
    if (!storagePath) return res.status(400).json({ success: false, message: 'path is required' });
    try {
        const url = await getSignedStorageUrl(storagePath);
        res.json({ success: true, url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/update-status', async (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id, status } = req.body;
    try {
        await db.query('UPDATE applications SET status = $1 WHERE id = $2', [status, id]);
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send({ success: false });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM settings');
        const settings = {};
        result.rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
        res.json({ success: true, data: settings });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/settings', async (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { key, value } = req.body;
    try {
        await db.query(
            `INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
            [key, value]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Infinite Backend running on port ${PORT}`);
});
