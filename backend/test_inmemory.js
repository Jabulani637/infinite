const path = require('path');
const fs = require('fs');
const { generateApplicationPDF } = require('./services/pdfGenerator');
const { bundleDocuments } = require('./services/docBundler');
const { sendApplicationEmail } = require('./services/emailService');

// Helper to convert test files to Base64 data URLs
function getTestFileBase64(filename, mimeType) {
    const filePath = path.join(__dirname, 'test_files', filename);
    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: Test file ${filename} not found, generating dummy data.`);
        return `data:${mimeType};base64,${Buffer.from("dummy content").toString('base64')}`;
    }
    const fileBuffer = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
}

async function runTest() {
    console.log("--- Starting In-Memory Bundling & Emailing Test ---");

    const mockAppData = {
        reference_number: 'INF-2026-TEST',
        first_name: 'John',
        last_name: 'Doe',
        id_number: '9501015000082',
        dob: '1995-01-01',
        email: 'john.doe@example.com',
        cell_phone: '0821234567',
        purpose: 'Tuition Fees',
        bank_name: 'Standard Bank',
        bank_code: '051001',
        acc_num: '1234567890',
        acc_type: 'Savings',
        description: 'Need assistance paying tuition fee balance.',
        guarantor_name: 'Jane Doe',
        guarantor_id: '7001015000083',
        guarantor_phone: '0827654321',
        guarantor_rel: 'Mother',
        popia_consent: true,
        loan_amount: 5000,
        term_months: 3,
        total_settlement: 6500,
        discount_applied: false,
        
        // Mock Base64 encoded documents
        path_id: getTestFileBase64('id.pdf', 'application/pdf'),
        path_student_card: getTestFileBase64('student_card.png', 'image/png'),
        path_registration: getTestFileBase64('registration.pdf', 'application/pdf'),
        path_bank_statement: getTestFileBase64('bank.pdf', 'application/pdf'),
        path_selfie: getTestFileBase64('selfie.png', 'image/png'),
        path_nsfas: getTestFileBase64('nsfas.pdf', 'application/pdf'),
        path_address: getTestFileBase64('address.pdf', 'application/pdf')
    };

    try {
        // 1. Generate PDF summary in-memory
        console.log("1. Generating PDF Summary in-memory...");
        const pdfBuffer = await generateApplicationPDF(mockAppData);
        console.log(`✓ PDF Buffer generated successfully. Size: ${pdfBuffer.length} bytes`);

        // 2. Bundle documents in-memory
        console.log("2. Bundling documents into ZIP in-memory...");
        const zipBuffer = await bundleDocuments(pdfBuffer, mockAppData);
        console.log(`✓ ZIP Buffer generated successfully. Size: ${zipBuffer.length} bytes`);

        // 3. Write ZIP to a local test file for manual inspection (optional)
        const testZipPath = path.join(__dirname, 'test_result_bundle.zip');
        fs.writeFileSync(testZipPath, zipBuffer);
        console.log(`✓ ZIP file written to ${testZipPath} for manual validation.`);

        // 4. Test Email Sending
        console.log("4. Testing email sending...");
        // Set dummy SMTP details in process.env if not set, to test warning logs
        if (!process.env.EMAIL_PASSWORD) {
            console.log("Note: EMAIL_PASSWORD not set in env, expecting SMTP warning log.");
        }
        
        const emailSent = await sendApplicationEmail(zipBuffer, mockAppData, 'admin@example.com');
        console.log(`✓ Email sending process completed. Success status: ${emailSent}`);

        console.log("\n--- TEST COMPLETED SUCCESSFULLY ---");
    } catch (error) {
        console.error("❌ TEST FAILED:", error);
        process.exit(1);
    }
}

runTest();
