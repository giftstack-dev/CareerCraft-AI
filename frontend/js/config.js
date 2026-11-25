/**
 * CareerCraft AI — Public Frontend Configuration
 * Only public configuration values (Supabase URL, public Anon Key, Backend API URL)
 * belong here. Never place Gemini keys, service-role keys, or Flask secrets here.
 */

const runtimeConfig = window.__CAREERCRAFT_CONFIG__ || {};

export const APP_CONFIG = Object.freeze({
  appName: 'CareerCraft AI',
  apiBaseUrl: runtimeConfig.apiBaseUrl || 'http://127.0.0.1:5000',
  supabaseUrl: runtimeConfig.supabaseUrl || '',
  supabaseAnonKey: runtimeConfig.supabaseAnonKey || '',
});

export function isSupabasePublicConfigured() {
  return Boolean(
    APP_CONFIG.supabaseUrl &&
      !APP_CONFIG.supabaseUrl.startsWith('your_') &&
      APP_CONFIG.supabaseAnonKey &&
      !APP_CONFIG.supabaseAnonKey.startsWith('your_')
  );
}
