import nodemailer from 'nodemailer'
import jwt from 'jsonwebtoken'

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
})

export function generateSetupToken(email, memberId) {
  return jwt.sign({ email, memberId }, process.env.JWT_SECRET, { expiresIn: '48h' })
}

export function verifySetupToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}

export async function sendSetupEmail(name, email, memberId, token) {
  const setupUrl = `${process.env.FRONTEND_URL}/setup-password?token=${token}`

  await transporter.sendMail({
    from: `"MindzSpark Counseling" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'Set up your MindzSpark Portal password',
    html: `
      <div style="font-family: DM Sans, sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="background: #1a1f36; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ff6b35; margin: 0; font-size: 22px;">MindzSpark</h1>
          <p style="color: #a0aec0; margin: 4px 0 0; font-size: 13px;">Excellence is our Identity</p>
        </div>
        <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1a1f36;">Welcome, ${name}! 👋</h2>
          <p>Your MindzSpark Counseling Portal account is ready.</p>
          <p><strong>Member ID:</strong> <code style="background: #f9fafb; padding: 4px 8px; border-radius: 4px; font-size: 15px;">${memberId}</code></p>
          <p>Click the button below to set your password and access your portal:</p>
          <a href="${setupUrl}" style="display: inline-block; background: #ff6b35; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Set My Password →</a>
          <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">This link expires in 48 hours. If you didn't expect this email, ignore it.</p>
        </div>
      </div>
    `
  })
}

export async function sendLoginOtpEmail(name, email, otp) {
  await transporter.sendMail({
    from: `"MindzSpark Counseling" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'MindzSpark Portal - Login Verification Code',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="background: #1a1f36; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ff6b35; margin: 0;">MindzSpark</h1>
          <p style="color: #a0aec0; margin: 4px 0 0; font-size: 13px;">Excellence is our Identity</p>
        </div>
        <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1a1f36; margin-top: 0;">Login Verification</h2>
          <p>Hi ${name}, a login attempt was made on your account. Use the code below to complete sign-in:</p>
          <div style="background: #f9fafb; border: 2px dashed #ff6b35; border-radius: 8px; padding: 20px; text-align: center; margin: 16px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1a1f36;">${otp}</span>
          </div>
          <p style="color: #6b7280; font-size: 12px;">This code expires in 10 minutes. If you did not attempt to log in, please contact support immediately.</p>
        </div>
      </div>
    `
  })
}

export async function sendPasswordResetEmail(name, email, otp) {
  await transporter.sendMail({
    from: `"MindzSpark Counseling" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'MindzSpark Portal - Password Reset OTP',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="background: #1a1f36; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ff6b35; margin: 0;">MindzSpark</h1>
        </div>
        <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1a1f36;">Password Reset</h2>
          <p>Hi ${name}, your OTP is:</p>
          <div style="background: #f9fafb; border: 2px dashed #ff6b35; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1f36;">${otp}</span>
          </div>
          <p style="color: #6b7280; font-size: 12px;">This OTP expires in 10 minutes.</p>
        </div>
      </div>
    `
  })
}
