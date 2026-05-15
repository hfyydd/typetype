import { LlmProvider } from './types';

export interface LlmOauthConfig {
  enabled: boolean;
  provider: LlmProvider;
  access_token: string;
  token_type: string;
  expires_at: number;  // timestamp
  refresh_token?: string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

const OPENAI_AUTH_URL = 'https://auth.openai.com/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_SCOPE = 'modelkd-2024-05-01:read';
const REDIRECT_URI = 'http://localhost:5372/oauth/callback';

export interface OauthState {
  code_verifier: string;
  auth_window: Electron.BrowserWindow | null;
  resolve: (config: LlmOauthConfig) => void;
  reject: (error: Error) => void;
}

let oauthState: OauthState | null = null;

// Generate random string for state parameter
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Generate code verifier for PKCE
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Generate code challenge (SHA-256 of code verifier, base64url encoded)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function getAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: 'oAI_PKo_01',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: OPENAI_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OPENAI_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams({
    client_id: 'oAI_PKo_01',
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  };
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams({
    client_id: 'oAI_PKo_01',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  };
  return data;
}

export async function startOauthFlow(): Promise<LlmOauthConfig> {
  const { BrowserWindow, shell } = await import('electron');

  // Clean up any existing auth window
  if (oauthState?.auth_window && !oauthState.auth_window.isDestroyed()) {
    oauthState.auth_window.close();
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const authUrl = getAuthUrl(state, codeChallenge);

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      title: 'GPT 登录',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    oauthState = {
      code_verifier: codeVerifier,
      auth_window: authWindow,
      resolve,
      reject,
    };

    authWindow.loadURL(authUrl);

    // Handle callback at localhost
    authWindow.webContents.on('will-navigate', async (event, url) => {
      if (!url.startsWith(REDIRECT_URI)) {
        return;
      }

      event.preventDefault();
      authWindow.close();

      try {
        const parsedUrl = new URL(url);
        const returnedState = parsedUrl.searchParams.get('state');
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');

        if (error) {
          throw new Error(`OAuth error: ${error}`);
        }

        if (state !== returnedState) {
          throw new Error('State mismatch - possible CSRF attack');
        }

        if (!code) {
          throw new Error('No authorization code received');
        }

        const tokenData = await exchangeCodeForToken(code, codeVerifier);

        const config: LlmOauthConfig = {
          enabled: true,
          provider: 'openai',
          access_token: tokenData.access_token,
          token_type: tokenData.token_type || 'Bearer',
          expires_at: Date.now() + (tokenData.expires_in * 1000),
          refresh_token: tokenData.refresh_token,
          base_url: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 4096,
        };

        resolve(config);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    // Handle window close without callback
    authWindow.on('closed', () => {
      if (oauthState) {
        oauthState.reject(new Error('User cancelled login'));
        oauthState = null;
      }
    });

    // Open external links in default browser
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://auth.openai.com') || url.startsWith('https://platform.openai.com')) {
        return { action: 'allow' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

export function isTokenExpired(config: LlmOauthConfig): boolean {
  // Consider expired 5 minutes before actual expiry
  return Date.now() >= (config.expires_at - 5 * 60 * 1000);
}

export async function ensureValidToken(config: LlmOauthConfig): Promise<LlmOauthConfig> {
  if (!isTokenExpired(config)) {
    return config;
  }

  if (!config.refresh_token) {
    throw new Error('No refresh token available');
  }

  const tokenData = await refreshAccessToken(config.refresh_token);
  return {
    ...config,
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'Bearer',
    expires_at: Date.now() + (tokenData.expires_in * 1000),
    refresh_token: tokenData.refresh_token || config.refresh_token,
  };
}