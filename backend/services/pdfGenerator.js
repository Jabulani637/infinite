const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates a PDF summary of the loan application
 * @param {Object} appData - Application data object
 * @param {string} outputPath - Path where PDF will be saved
 * @returns {Promise<string>} - Path to generated PDF
 */
async function generateApplicationPDF(appData) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];
            
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => {
                resolve(Buffer.concat(buffers));
            });
            doc.on('error', (err) => {
                reject(err);
            });

            // Header
            doc.fontSize(24).fillColor('#1e3a8a').text('INFINITY LOAN APPLICATION', { align: 'center' });
            doc.moveDown();
            
            // Reference Number
            doc.fontSize(12).fillColor('#666').text(`Reference Number: ${appData.reference_number}`, { align: 'center' });
            doc.fontSize(10).fillColor('#666').text(`Submitted: ${new Date().toLocaleDateString()}`, { align: 'center' });
            doc.moveDown();
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();

            // Personal Information Section
            doc.fontSize(16).fillColor('#1e3a8a').text('PERSONAL INFORMATION', { underline: true });
            doc.moveDown(0.5);
            
            const personalInfo = [
                ['Full Name:', `${appData.first_name} ${appData.last_name}`],
                ['ID Number:', appData.id_number],
                ['Date of Birth:', new Date(appData.dob).toLocaleDateString()],
                ['Email:', appData.email],
                ['Cell Phone:', appData.cell_phone],
                ['POPIA Consent:', appData.popia_consent ? 'Yes' : 'No']
            ];

            personalInfo.forEach(([label, value]) => {
                doc.fontSize(11).fillColor('#333').text(label, { continued: true });
                doc.fillColor('#666').text(` ${value}`);
            });

            doc.moveDown();

            // Loan Details Section
            doc.fontSize(16).fillColor('#1e3a8a').text('LOAN DETAILS', { underline: true });
            doc.moveDown(0.5);
            
            const loanDetails = [
                ['Purpose:', appData.purpose],
                ['Description:', appData.description],
                ['Loan Amount:', `R ${appData.loan_amount || '0.00'}`],
                ['Term:', `${appData.term_months || '0'} months`],
                ['Total Settlement:', `R ${appData.total_settlement || '0.00'}`],
                ['Discount Applied:', appData.discount_applied ? 'Yes (2%)' : 'No']
            ];

            loanDetails.forEach(([label, value]) => {
                doc.fontSize(11).fillColor('#333').text(label, { continued: true });
                doc.fillColor('#666').text(` ${value}`);
            });

            doc.moveDown();

            // Bank Information Section
            doc.fontSize(16).fillColor('#1e3a8a').text('BANK INFORMATION (FOR PAYOUT)', { underline: true });
            doc.moveDown(0.5);
            
            const bankInfo = [
                ['Bank Name:', appData.bank_name],
                ['Bank Code (Branch Code):', appData.bank_code || 'Not provided'],
                ['Account Number:', appData.acc_num],
                ['Account Type:', appData.acc_type || 'Not provided']
            ];

            bankInfo.forEach(([label, value]) => {
                doc.fontSize(11).fillColor('#333').text(label, { continued: true });
                doc.fillColor('#666').text(` ${value}`);
            });

            doc.moveDown();

            // Guarantor Information Section
            doc.fontSize(16).fillColor('#1e3a8a').text('GUARANTOR INFORMATION', { underline: true });
            doc.moveDown(0.5);
            
            const guarantorInfo = [
                ['Name:', appData.guarantor_name],
                ['ID Number:', appData.guarantor_id],
                ['Phone:', appData.guarantor_phone],
                ['Relationship:', appData.guarantor_rel]
            ];

            guarantorInfo.forEach(([label, value]) => {
                doc.fontSize(11).fillColor('#333').text(label, { continued: true });
                doc.fillColor('#666').text(` ${value}`);
            });

            doc.moveDown();
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();

            // Documents Section
            doc.fontSize(16).fillColor('#1e3a8a').text('UPLOADED DOCUMENTS', { underline: true });
            doc.moveDown(0.5);
            
            const documents = [
                ['ID Document:', appData.path_id ? '✓ Uploaded' : '✗ Missing'],
                ['Student Card:', appData.path_student_card ? '✓ Uploaded' : '✗ Missing'],
                ['Proof of Registration:', appData.path_registration ? '✓ Uploaded' : '✗ Missing'],
                ['Bank Statement:', appData.path_bank_statement ? '✓ Uploaded' : '✗ Missing'],
                ['Selfie:', appData.path_selfie ? '✓ Uploaded' : '✗ Missing'],
                ['NSFAS Status:', appData.path_nsfas ? '✓ Uploaded' : '✗ Missing'],
                ['Proof of Address:', appData.path_address ? '✓ Uploaded' : '✗ Missing']
            ];

            documents.forEach(([label, value]) => {
                doc.fontSize(11).fillColor('#333').text(label, { continued: true });
                doc.fillColor(value.includes('✓') ? 'green' : 'red').text(` ${value}`);
            });

            // Footer
            doc.moveDown(2);
            doc.fontSize(9).fillColor('#999').text('Generated by Infinity Loan Application System', { align: 'center' });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateApplicationPDF };
