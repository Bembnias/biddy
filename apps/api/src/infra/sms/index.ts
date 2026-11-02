// Publiczne API SMS-ów: adapter SMS_SENDER (SMSAPI albo atrapa) i SmsModule.
export {
  LoggingSmsSender,
  SMS_SENDER,
  SmsSendError,
  SmsapiSmsSender,
  createSmsSender,
  type SmsMessage,
  type SmsSender,
} from './sms-sender.js';
export { SmsModule } from './sms.module.js';
