const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  return {
    sendMail: async (mailOptions) => {
      console.log('Mock email sent:', mailOptions);
    }
  };
};

const transporter = createTransporter();

const sendOtpEmail = async ({ to, appName, otpCode, expiresInMinutes }) => {
  const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2>${appName} Password Reset</h2>
      <p>Your one-time password (OTP) is:</p>
      <p style="font-size: 24px; letter-spacing: 4px;"><strong>${otpCode}</strong></p>
      <p>The code expires in ${expiresInMinutes} minutes.</p>
      <p>If you did not request this reset, please secure your account.</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'no-reply@example.com',
    to,
    subject: `${appName} Password Reset`,
    html
  });
};

module.exports = {
  sendOtpEmail
};

