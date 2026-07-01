const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Sends an email with the application bundle attached
 * @param {string} bundlePath - Path to the ZIP bundle
 * @param {Object} appData - Application data
 * @param {string} recipientEmail - Email address to send to (from admin settings)
 * @returns {Promise<boolean>} - Success status
 */
async function sendApplicationEmail(zipBuffer, appData, recipientEmail) {
    // Check if EMAIL_PASSWORD is set. If not, log a friendly warning and return gracefully
    if (!process.env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD.trim() === '' || process.env.EMAIL_PASSWORD === 'your_email_password') {
        console.warn('⚠️ [SMTP Warning] EMAIL_PASSWORD is not configured in .env. Skipping email delivery.');
        return false;
    }

    try {
        // Create transporter
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: process.env.EMAIL_SECURE === 'true' || false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        // Verify transporter configuration
        try {
            await transporter.verify();
        } catch (verifyError) {
            console.warn(`⚠️ [SMTP Warning] SMTP verification failed: ${verifyError.message}. Skipping email delivery.`);
            return false;
        }

        // Use provided recipient email or fall back to .env
        const toEmail = recipientEmail || process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

        const mailOptions = {
            from: `"Infinity Loan System" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `New Loan Application - ${appData.reference_number}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1e3a8a;">New Loan Application Received</h2>
                    <p>A new loan application has been submitted with the following details:</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        <tr style="background-color: #f3f4f6;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Reference Number:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.reference_number}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Applicant Name:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.first_name} ${appData.last_name}</td>
                        </tr>
                        <tr style="background-color: #f3f4f6;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>ID Number:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.id_number}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Email:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.email}</td>
                        </tr>
                        <tr style="background-color: #f3f4f6;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Cell Phone:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.cell_phone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Loan Amount:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">R ${appData.loan_amount || '0.00'}</td>
                        </tr>
                        <tr style="background-color: #f3f4f6;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Purpose:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${appData.purpose}</td>
                        </tr>
                    </table>

                    <p><strong>Attached:</strong> Complete application bundle including summary PDF and all uploaded documents.</p>
                    
                    <p style="color: #666; font-size: 12px;">
                        Please review the application in the admin dashboard for further action.<br>
                        This is an automated message from the Infinity Loan Application System.
                    </p>
                </div>
            `,
            attachments: [
                {
                    filename: `application_${appData.reference_number}.zip`,
                    content: zipBuffer
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return true;

    } catch (error) {
        console.warn('⚠️ [SMTP Warning] Error sending email:', error.message);
        return false;
    }
}

module.exports = { sendApplicationEmail };
