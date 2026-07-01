const { ZipArchive } = require('archiver');
const fs = require('fs');
const path = require('path');

/**
 * Creates a ZIP bundle containing the application PDF and all uploaded documents
 * @param {string} pdfPath - Path to the generated PDF
 * @param {Object} appData - Application data containing file paths
 * @param {string} outputPath - Path where the ZIP file will be saved
 * @returns {Promise<string>} - Path to generated ZIP file
 */
async function bundleDocuments(pdfBuffer, appData) {
    return new Promise((resolve, reject) => {
        try {
            const archive = new ZipArchive({ zlib: { level: 9 } });
            const buffers = [];

            archive.on('data', (chunk) => buffers.push(chunk));
            archive.on('end', () => {
                resolve(Buffer.concat(buffers));
            });

            archive.on('error', (err) => {
                reject(err);
            });

            // Add the PDF summary
            if (pdfBuffer) {
                archive.append(pdfBuffer, { name: 'application_summary.pdf' });
            }

            // Add uploaded documents (decoded from Base64 Data URLs)
            const documentMap = {
                'path_id': 'id_document',
                'path_student_card': 'student_card',
                'path_registration': 'proof_of_registration',
                'path_bank_statement': 'bank_statement',
                'path_selfie': 'selfie',
                'path_nsfas': 'nsfas_status',
                'path_address': 'proof_of_address'
            };

            for (const [dbField, fileName] of Object.entries(documentMap)) {
                const base64Data = appData[dbField];
                if (base64Data && base64Data.startsWith('data:')) {
                    const matches = base64Data.match(/^data:(.+);base64,(.*)$/);
                    if (matches) {
                        const mimeType = matches[1];
                        const base64Content = matches[2];
                        const buffer = Buffer.from(base64Content, 'base64');
                        
                        let ext = '.bin';
                        if (mimeType.includes('pdf')) ext = '.pdf';
                        else if (mimeType.includes('png')) ext = '.png';
                        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
                        
                        archive.append(buffer, { name: `${fileName}${ext}` });
                    }
                }
            }

            archive.finalize();

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { bundleDocuments };
