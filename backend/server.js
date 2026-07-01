const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');

// Import services
const { generateApplicationPDF } = require('./services/pdfGenerator');
const { bundleDocuments } = require('./services/docBundler');
const { sendApplicationEmail } = require('./services/emailService');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. AWS ALB, Nginx)
app.use(cors());
app.use(bodyParser.json());

// Resolve paths relative to the root directory
const rootDir = path.join(__dirname, '..');
const frontendPath = path.join(rootDir, 'frontend');

// SQLite database setup
const dbPath = path.join(__dirname, 'infinity.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('SQLite Connected...');
        initDb();
    }
});

const initDb = async () => {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            // Convert PostgreSQL schema to SQLite
            const sqliteSchema = schemaSql
                .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
                .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'DATETIME DEFAULT CURRENT_TIMESTAMP')
                .replace(/DATE/g, 'TEXT')
                .replace(/DECIMAL\([^)]+\)/g, 'REAL')
                .replace(/BOOLEAN/g, 'INTEGER')
                .replace(/INSERT INTO settings \(setting_key, setting_value\) VALUES \('whatsapp_number', '27682749288'\) ON CONFLICT DO NOTHING;/g, 'INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES (\'whatsapp_number\', \'27682749288\');')
                .replace(/ON CONFLICT \(setting_key\) DO UPDATE SET setting_value = EXCLUDED.setting_value/g, 'ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value');
            
            db.exec(sqliteSchema, (err) => {
                if (err) {
                    console.error('Failed to initialize database schema:', err.message);
                } else {
                    console.log('Database schema initialized successfully.');
                }
            });
        } else {
            console.warn('schema.sql not found, skipping database table creation.');
        }
    } catch (err) {
        console.error('Failed to initialize database schema:', err.message);
    }
};

// Serve static files from the 'frontend' directory
app.use(express.static(frontendPath));

// Configure Multer to use in-memory storage (no local disk storage, no AWS S3)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit per file
    }
});

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

/**
 * Processes application bundle: generates PDF, bundles documents, and sends email
 * @param {Object} appData - Application data
 */
async function processApplicationBundle(appData) {
    try {
        // Generate PDF summary in-memory
        console.log('Generating PDF summary in-memory...');
        const pdfBuffer = await generateApplicationPDF(appData);

        // Bundle PDF with uploaded documents in-memory
        console.log('Bundling documents in-memory...');
        const zipBuffer = await bundleDocuments(pdfBuffer, appData);

        // Fetch business email from settings
        let recipientEmail = null;
        try {
            const settingsResult = await new Promise((resolve, reject) => {
                db.get("SELECT setting_value FROM settings WHERE setting_key = 'business_email'", (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (settingsResult && settingsResult.setting_value) {
                recipientEmail = settingsResult.setting_value;
                console.log(`Using business email from settings: ${recipientEmail}`);
            }
        } catch (settingsError) {
            console.error('Error fetching business email from settings:', settingsError);
        }

        // Send email with bundle
        console.log('Sending email with in-memory ZIP...');
        const emailSent = await sendApplicationEmail(zipBuffer, appData, recipientEmail);
        
        if (emailSent) {
            console.log(`Application bundle sent successfully for ${appData.reference_number}`);
        } else {
            console.warn(`Failed to send email for ${appData.reference_number}`);
        }

    } catch (error) {
        console.error('Error in processApplicationBundle:', error);
    }
}

app.post('/api/apply', applyLimiter, docUploadFields, (req, res) => {
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
    Object.keys(fileMap).forEach(field => {
        if (req.files && req.files[field]) {
            const file = req.files[field][0];
            // Convert file buffer to Base64 data URL
            const base64Str = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
            appData[fileMap[field]] = base64Str;
        } else {
            missingFiles.push(`Document ${field} is required.`);
        }
    });

    if (missingFiles.length > 0) {
        return res.status(400).json({ success: false, message: missingFiles[0], errors: missingFiles });
    }

    const columns = Object.keys(appData);
    const values = Object.values(appData);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders})`;

    db.run(sql, values, async function(err) {
        if (err) {
            console.error(err);
            return res.status(500).send({ success: false, message: 'Database error' });
        }

        // Generate PDF and send email asynchronously
        processApplicationBundle(appData).catch(error => {
            console.error('Error processing application bundle:', error);
        });

        res.send({ success: true, message: 'Application saved' });
    });
});

app.get('/api/admin/applications', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const sql = "SELECT * FROM applications ORDER BY created_at DESC";
    db.all(sql, (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json(rows);
    });
});

app.post('/api/admin/update-status', (req, res) => {
    if (req.headers['authorization'] !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id, status } = req.body;
    const sql = "UPDATE applications SET status = ? WHERE id = ?";
    db.run(sql, [status, id], (err) => {
        if (err) return res.status(500).send({ success: false });
        res.send({ success: true });
    });
});

app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        const settings = {};
        rows.forEach(row => {
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
    const sql = "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value";
    db.run(sql, [key, value], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.listen(3000, () => {
    console.log('Infinite Backend running on http://localhost:3000');
});
