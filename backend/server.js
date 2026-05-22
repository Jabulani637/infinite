const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. AWS ALB, Nginx)
app.use(cors());
app.use(bodyParser.json());

// Resolve paths relative to the root directory
const rootDir = path.join(__dirname, '..');
const frontendPath = path.join(rootDir, 'frontend');

const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'infinity_db',
    port: process.env.DB_PORT || 5432
});

const initDb = async () => {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await db.query(schemaSql);
            console.log('Database schema check completed: tables initialized.');
        } else {
            console.warn('schema.sql not found, skipping database table creation.');
        }
    } catch (err) {
        console.error('Failed to initialize database schema:', err.message);
    }
};

db.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        console.log('PostgreSQL connection required for application submissions.');
    } else {
        console.log('PostgreSQL Connected...');
        release();
        initDb();
    }
});

// Serve static files from the 'frontend' directory
app.use(express.static(frontendPath));

// Configure Storage based on environment (AWS S3 with local disk fallback)
let upload;
const isS3Configured = process.env.AWS_ACCESS_KEY_ID && 
                       process.env.AWS_ACCESS_KEY_ID !== 'your_access_key' &&
                       process.env.AWS_SECRET_ACCESS_KEY && 
                       process.env.AWS_SECRET_ACCESS_KEY !== 'your_secret_key' &&
                       process.env.AWS_S3_BUCKET_NAME &&
                       process.env.AWS_S3_BUCKET_NAME !== 'your_bucket_name';

if (isS3Configured) {
    console.log('AWS S3 storage active. Uploads will be stored in S3 bucket:', process.env.AWS_S3_BUCKET_NAME);
    const s3 = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    upload = multer({
        storage: multerS3({
            s3: s3,
            bucket: process.env.AWS_S3_BUCKET_NAME,
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: function (req, file, cb) {
                cb(null, `uploads/${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
            }
        })
    });
} else {
    console.log('AWS S3 not configured or using placeholders. Falling back to local disk storage.');
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadsDir);
        },
        filename: function (req, file, cb) {
            cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
        }
    });

    upload = multer({ storage: storage });
}

// Serve uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Simple Admin Credentials
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Endpoint for Admin Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: ADMIN_TOKEN });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// Endpoint to submit application
const docUploadFields = upload.fields([
    { name: 'tag-id', maxCount: 1 },
    { name: 'tag-student-card', maxCount: 1 },
    { name: 'tag-registration', maxCount: 1 },
    { name: 'tag-bank', maxCount: 1 },
    { name: 'tag-selfie', maxCount: 1 },
    { name: 'tag-nsfas', maxCount: 1 },
    { name: 'tag-address', maxCount: 1 }
]);

// Rate limiter to prevent brute-force application submissions
const applyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 5, // limit each IP to 5 requests per hour
    message: {
        success: false,
        message: "Too many applications submitted from this IP. Please try again after an hour."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Server-side validation to ensure data integrity and security
 */
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
        errors.push("ID Number must be exactly 13 digits.");
    }

    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push("Invalid email format.");
    }

    if (data.popia_consent !== true) {
        errors.push("POPIA consent is required to process this application.");
    }

    return errors;
};

app.post('/api/apply', applyLimiter, docUploadFields, (req, res) => {
    const allowedDataFields = [
        'reference_number', 'first_name', 'last_name', 'id_number', 'dob', 
        'email', 'cell_phone', 'purpose', 'bank_name', 'acc_num', 
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
    Object.keys(fileMap).forEach(field => {
        if (req.files && req.files[field]) {
            const file = req.files[field][0];
            // Use S3 location if uploaded to S3, otherwise fall back to local URL path
            appData[fileMap[field]] = file.location || `/uploads/${file.filename}`;
        } else {
            missingFiles.push(`Document ${field} is required.`);
        }
    });

    if (missingFiles.length > 0) {
        return res.status(400).json({ success: false, message: missingFiles[0], errors: missingFiles });
    }

    const columns = Object.keys(appData);
    const values = Object.values(appData);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders})`;

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ success: false, message: 'Database error' });
        }
        res.send({ success: true, message: 'Application saved' });
    });
});

app.get('/api/admin/applications', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const sql = "SELECT * FROM applications ORDER BY created_at DESC";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json(result.rows);
    });
});

app.post('/api/admin/update-status', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id, status } = req.body;
    const sql = "UPDATE applications SET status = $1 WHERE id = $2";
    db.query(sql, [status, id], (err, result) => {
        if (err) return res.status(500).send({ success: false });
        res.send({ success: true });
    });
});

app.get('/api/settings', (req, res) => {
    db.query("SELECT * FROM settings", (err, result) => {
        if (err) return res.status(500).json({ success: false });
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json({ success: true, data: settings });
    });
});

app.post('/api/admin/settings', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { key, value } = req.body;
    const sql = "INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value";
    db.query(sql, [key, value], (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.listen(3000, () => {
    console.log('Infinite Backend running on http://localhost:3000');
});
