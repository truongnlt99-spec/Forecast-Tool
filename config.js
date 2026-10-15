// ĐIỀN 2 GIÁ TRỊ NÀY TRƯỚC KHI DEPLOY — xem hướng dẫn trong README.md
window.CS_TOOL_CONFIG = {
  // OAuth Client ID lấy từ Google Cloud Console (Credentials > OAuth client ID)
  CLIENT_ID: '621765385511-nn699q39euvcf2slmqbv9jp6oi70kpgb.apps.googleusercontent.com',

  // BẢN TEST (nhánh supabase-test): trỏ tới Edge Function Supabase thay cho Apps Script.
  // Bản thật (nhánh main) vẫn dùng Apps Script /exec — KHÔNG merge file này vào main.
  API_URL: 'https://lheaoklvumzapmwuhysr.supabase.co/functions/v1/api',

  // Domain email được phép đăng nhập
  ALLOWED_DOMAIN: 'base.vn',
};
