require('dotenv').config(); // Ensure this is at the very top
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Automatically serve the static frontend files (index.html, script.js, style.css)
app.use(express.static(__dirname));

// AWS S3 Storage configuration will be initialized below

const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'infinity_db',
    port: process.env.DB_PORT || 5432
});

db.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        console.log('Server running in partial mode (Frontend only).');
    } else {
        console.log('PostgreSQL Connected...');
        release();
    }
});

// Configure AWS S3 Client
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Configure Multer to use S3
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            cb(null, `uploads/${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
        }
    })
});

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

    if (data.popia_consent !== true) {
        errors.push("POPIA consent is required to process this application.");
    }

    if (data.id_number && !/^\d{13}$/.test(data.id_number)) {
        errors.push("ID Number must be exactly 13 digits.");
    }

    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push("Invalid email format.");
    }

    return errors;
};

app.post('/api/apply', applyLimiter, docUploadFields, (req, res) => {
    // 1. Whitelist allowed fields to prevent Mass Assignment/Schema Injection
    const allowedDataFields = [
        'reference_number', 'first_name', 'last_name', 'id_number', 'dob', 
        'email', 'cell_phone', 'purpose', 'bank_name', 'acc_num', 
        'description', 'guarantor_name', 'guarantor_id', 'guarantor_phone', 
        'guarantor_rel', 'popia_consent'
    ];

    const appData = {};
    allowedDataFields.forEach(field => {
        if (req.body[field] !== undefined) {
            let value = req.body[field];
            if (field === 'popia_consent') {
                value = (value === '1' || value === 'true');
            } else if (typeof value === 'string') {
                value = value.trim();
            }
            appData[field] = value;
        }
    });

    // 2. Validate extracted data
    const validationErrors = validateInput(appData);
    if (validationErrors.length > 0) {
        return res.status(400).json({ success: false, message: validationErrors[0], errors: validationErrors });
    }
    
    // 3. Map uploaded files to specific database columns
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
            appData[fileMap[field]] = req.files[field][0].location; // Use S3 URL instead of local path
        } else {
            missingFiles.push(`Document ${field} is required.`);
        }
    });

    if (missingFiles.length > 0) {
        return res.status(400).json({ success: false, message: missingFiles[0], errors: missingFiles });
    }

    // 4. Execute parameterized query (The key protection against SQL Injection)
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

// Endpoint for Admin Dashboard to get all applications
app.get('/api/admin/applications', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const sql = "SELECT * FROM applications ORDER BY created_at DESC";
    db.query(sql, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false });
        }
        res.json(result.rows);
    });
});

// Endpoint to update status
app.post('/api/admin/update-status', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id, status } = req.body;
    const sql = "UPDATE applications SET status = $1 WHERE id = $2";
    db.query(sql, [status, id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ success: false });
        }
        res.send({ success: true });
    });
});

app.listen(3000, () => {
    console.log('Server started on port 3000');
});