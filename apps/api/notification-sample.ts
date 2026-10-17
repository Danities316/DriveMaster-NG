import { Resend } from 'resend';
import axios from 'axios';
import { logger } from '../utils/logger';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

interface SMSPayload {
  phoneNumber: string;
  message: string;
}

interface NotificationPayload {
  email?: EmailPayload;
  sms?: SMSPayload;
}

export class NotificationService {
  private static resend: Resend;
  private static mailFrom = process.env.MAIL_FROM || 'noreply@adinopos.com';
  private static get smsProvider() { return process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? 'disabled' : 'mock'); }

  static isSmsConfigured(): boolean {
    return this.smsProvider === 'kudis' ? !!process.env.KUDISMS_API_KEY : this.smsProvider === 'mock' && process.env.NODE_ENV !== 'production';
  }

  static initialize() {
    // Initialize Resend for email
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
      logger.info('Resend email service initialized');
    } else {
      logger.warn('Resend not configured. Check RESEND_API_KEY environment variable.');
    }

    // Log SMS provider mode
    logger.info(`SMS service initialized in ${this.smsProvider} mode`);
  }

  /**
   * Send email via Resend
   */
  static async sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      if (!this.resend) {
        logger.warn('Resend not initialized. Check RESEND_API_KEY environment variable.');
        return { success: false, error: 'Email service not configured' };
      }

      const response = await this.resend.emails.send({
        from: payload.from || this.mailFrom,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });

      if (response.error) {
        logger.error('Email provider rejected delivery');
        return { success: false, error: response.error.message };
      }

      logger.info('Email accepted by provider');
      return { success: true, messageId: response.data?.id };
    } catch (error: any) {
      logger.error('Email service request failed');
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SMS via provider (mock or KudiSMS)
   */
  static async sendSMS(payload: SMSPayload): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      return await this.sendSms(payload.phoneNumber, payload.message);
    } catch (error: any) {
      logger.error('SMS service request failed');
      return { success: false, error: error.message };
    }
  }

  /**
   * Internal SMS sending with provider support
   */
  private static async sendSms(to: string, message: string): Promise<{ success: boolean; error?: string; messageId?: string }> {
    if (this.smsProvider === 'mock' && process.env.NODE_ENV !== 'production') {
      // Mock mode: log SMS instead of sending
      const mockMessageId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      logger.info('SMS delivery requested (recipient and content omitted)');
      return { success: true, messageId: mockMessageId };
    }

    if (this.smsProvider === 'kudis') {
      if (!process.env.KUDISMS_API_KEY) {
        logger.warn('KudiSMS is not configured.');
        return { success: false, error: 'SMS service not configured' };
      }

      logger.info('SMS delivery requested (recipient and content omitted)');

      // Real KudiSMS mode: send via API
      try {
        // 1. Prepare parameters using KudiSMS specific payload conventions
        const payload = {
          token: process.env.KUDISMS_API_KEY,          // Changed from username/password
          senderID: process.env.KUDISMS_SENDER_ID || 'SYSTEM', // KudiSMS uses "senderID" instead of "sender"
          recipients: to.replace(/^\+/, ''),                                       // Recipient phone number (e.g., 2348012345678)
          message: message,
          route: 2,
        };

        // 2. Execute POST request to the correct portal endpoint
        const response = await axios.post('https://my.kudisms.net/api/corporate', payload, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 10000 // Best Practice: Always set a timeout for critical 3rd-party services
        });

        const responseData = response.data;

        // 3. Robust response evaluation
        // KudiSMS usually responds with a "success" string status or specific code upon acceptance
        if (responseData && (responseData.status === 'success' || responseData.success === true || responseData.code === 100)) {
          logger.info('SMS accepted by provider');

          return {
            success: true,
            messageId: responseData.message_id || responseData.messageId
          };
        } else {
          // API responded but rejected the text delivery (e.g., "Invalid Sender ID" or "Insufficient Units")
          const errorMessage = responseData.message || responseData.error || responseData.description || 'API rejection';
          logger.warn('SMS provider rejected delivery');
          logger.error('SMS delivery failed');

          return { success: false, error: errorMessage };
        }

      } catch (error: any) {
        // Catches network connection drops, bad SSL, or server HTTP error states (4xx/5xx)
        const errorDetails = error.response?.data?.message || error.message;
        logger.error('SMS provider communication failed');

        return { success: false, error: `Network/API error: ${errorDetails}` };
      }
    }

    logger.warn(`Unknown SMS provider: ${this.smsProvider}`);
    return { success: false, error: `Unknown SMS provider: ${this.smsProvider}` };
  }

  /**
   * Send both email and SMS notifications
   */
  static async sendNotification(payload: NotificationPayload): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Send email if provided
    if (payload.email) {
      const emailResult = await this.sendEmail(payload.email);
      if (!emailResult.success) {
        errors.push(`Email: ${emailResult.error}`);
      }
    }

    // Send SMS if provided
    if (payload.sms) {
      const smsResult = await this.sendSMS(payload.sms);
      if (!smsResult.success) {
        errors.push(`SMS: ${smsResult.error}`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Tenant Onboarding Email
   */
  static async sendOnboardingEmail(
    email: string,
    tenantName: string,
    ownerName: string,
    verificationUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #D4AF37 0%, #C19A3E 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .cta-button { display: inline-block; background: #D4AF37; color: #333; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #ddd; }
            .badge { display: inline-block; background: #D4AF37; color: #333; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ADINO POS! 🎉</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${ownerName}</strong>,</p>
              <p>Thank you for signing up for <strong>${tenantName}</strong>! We're excited to have you on board.</p>
              
              <h3>Next Steps:</h3>
              <ol>
                <li>Verify your email address by clicking the button below</li>
                <li>Log in to your ADINO POS dashboard</li>
                <li>Set up your products and inventory</li>
                <li>Start accepting sales right away</li>
              </ol>

              <div style="text-align: center;">
                <a href="${verificationUrl}" class="cta-button">Verify Email Address →</a>
              </div>

              <p style="color: #666; font-size: 14px;">
                <strong>Note:</strong> This link will expire in 24 hours. If you didn't sign up for ADINO POS, please ignore this email.
              </p>

              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

              <h4>About ADINO POS:</h4>
              <ul style="color: #666; font-size: 14px;">
                <li>✓ Offline-first POS system</li>
                <li>✓ Real-time sales tracking</li>
                <li>✓ Multi-user support</li>
                <li>✓ Inventory management</li>
                <li>✓ Email receipts & reporting</li>
                <li>✓ Works on any device</li>
              </ul>
            </div>
            <div class="footer">
              <p><strong>ADINO POS</strong> - Your Complete Retail Management Solution</p>
              <p>© 2026 Adino. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return (await this.sendEmail({
      to: email,
      subject: `Welcome ${ownerName}! Verify Your ADINO POS Account`,
      html,
    })) as any;
  }

  /**
   * Email Verification Confirmation
   */
  static async sendEmailVerificationConfirm(
    email: string,
    tenantName: string,
    loginUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #27AE60 0%, #1E8449 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .cta-button { display: inline-block; background: #27AE60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Email Verified! ✓</h1>
            </div>
            <div class="content">
              <div class="success-badge">✓</div>
              <p style="text-align: center; font-size: 16px;">Your email has been successfully verified!</p>
              
              <p>Your ADINO POS account for <strong>${tenantName}</strong> is now fully activated and ready to use.</p>

              <div style="text-align: center;">
                <a href="${loginUrl}" class="cta-button">Log In to Dashboard →</a>
              </div>

              <h4>You're all set!</h4>
              <p style="color: #666; font-size: 14px;">
                Your account is ready to go. Log in and start managing your retail business with ADINO POS.
              </p>
            </div>
            <div class="footer">
              <p><strong>ADINO POS</strong> - Your Complete Retail Management Solution</p>
              <p>© 2026 Adino. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return (await this.sendEmail({
      to: email,
      subject: `Email Verified - ${tenantName} Account Activated`,
      html,
    })) as any;
  }

  /**
   * Password Reset Email
   */
  static async sendPasswordResetEmail(
    email: string,
    ownerName: string,
    resetUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #E74C3C 0%, #C0392B 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .warning { background: #FFF3CD; border-left: 4px solid #FFC107; padding: 15px; margin: 20px 0; border-radius: 3px; }
            .cta-button { display: inline-block; background: #E74C3C; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Reset Your Password</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${ownerName}</strong>,</p>
              <p>We received a request to reset the password for your ADINO POS account.</p>

              <div class="warning">
                <strong>⚠️ Security Note:</strong> If you didn't request this password reset, you can safely ignore this email. Your account remains secure.
              </div>

              <p><strong>To reset your password, click the button below:</strong></p>

              <div style="text-align: center;">
                <a href="${resetUrl}" class="cta-button">Reset Password →</a>
              </div>

              <p style="color: #666; font-size: 14px;">
                This link will expire in 1 hour for security reasons.
              </p>

              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

              <h4>Didn't Request This?</h4>
              <p style="color: #666; font-size: 14px;">
                If you didn't request a password reset, your account is still secure. The reset link only works if someone has access to your email. No action is needed on your part.
              </p>
            </div>
            <div class="footer">
              <p><strong>ADINO POS</strong> - Your Complete Retail Management Solution</p>
              <p>© 2026 Adino. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return (await this.sendEmail({
      to: email,
      subject: `Password Reset Request for Your ADINO POS Account`,
      html,
    })) as any;
  }

  /**
   * Password Reset Confirmation
   */
  static async sendPasswordResetConfirmation(
    email: string,
    ownerName: string,
    loginUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #27AE60 0%, #1E8449 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .cta-button { display: inline-block; background: #27AE60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Changed Successfully ✓</h1>
            </div>
            <div class="content">
              <div class="success-badge">✓</div>
              <p>Hi <strong>${ownerName}</strong>,</p>
              <p>Your password has been successfully reset. You can now log in with your new password.</p>

              <div style="text-align: center;">
                <a href="${loginUrl}" class="cta-button">Log In →</a>
              </div>

              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

              <h4>Security Tips:</h4>
              <ul style="color: #666; font-size: 14px;">
                <li>Never share your password with anyone</li>
                <li>Use a unique, strong password</li>
                <li>Log out when using shared devices</li>
                <li>Be aware of phishing emails</li>
              </ul>
            </div>
            <div class="footer">
              <p><strong>ADINO POS</strong> - Your Complete Retail Management Solution</p>
              <p>© 2026 Adino. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return (await this.sendEmail({
      to: email,
      subject: `Password Changed - ${ownerName}'s ADINO POS Account`,
      html,
    })) as any;
  }

  /**
   * SMS Onboarding Notification
   */
  static async sendOnboardingSMS(
    phoneNumber: string,
    code: string | number
  ): Promise<{ success: boolean; error?: string }> {
    const message = `Your ADINOPOS login verification code is ${code}. Valid for 10 mins.`;

    return (await this.sendSMS({
      phoneNumber,
      message,
    })) as any;
  }

  /**
   * SMS Account Lockout Notification
   */
  static async sendAccountLockedSMS(
    phoneNumber: string,
    tenantName: string,
    supportUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const message = `Security Alert: Your ${tenantName} ADINO POS account has been locked due to multiple failed login attempts. Contact support: ${supportUrl}`;

    return (await this.sendSMS({
      phoneNumber,
      message,
    })) as any;
  }

  /**
   * SMS Password Reset OTP (if implementing OTP-based reset)
   */
  static async sendPasswordResetOTPSMS(
    phoneNumber: string,
    otp: string
  ): Promise<{ success: boolean; error?: string }> {
    const message = `Your ADINO POS password reset code is: ${otp}. This code expires in 10 minutes. Never share this code.`;

    return (await this.sendSMS({
      phoneNumber,
      message,
    })) as any;
  }

  /**
   * SMS Login Alert
   */
  static async sendLoginAlertSMS(
    phoneNumber: string,
    tenantName: string,
    deviceInfo: string
  ): Promise<{ success: boolean; error?: string }> {
    const message = `New login to ${tenantName} ADINO POS account from ${deviceInfo}. If this wasn't you, change your password immediately.`;

    return (await this.sendSMS({
      phoneNumber,
      message,
    })) as any;
  }
}

// Initialize on module load
NotificationService.initialize();
