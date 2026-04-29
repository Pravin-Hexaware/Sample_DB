import { environment } from '../environments/environment';
 
function normalizeApiBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) {
    return '/InfoDocs-AI/api';
  }
  const withLeading = t.startsWith('/') ? t : `/${t}`;
  // Collapse legacy/typo double basename in env strings
  return withLeading.replace(/\/InfoDocs-AI\/InfoDocs-AI\//g, '/InfoDocs-AI/');
}
 
export const API_BASE_URL = normalizeApiBase(environment.apiBaseUrl);