/**
 * Deklarasi minimal untuk google-auth-library.
 *
 * Paket 9.15.1 yang terpasang di lingkungan build tidak menyertakan
 * build/src/index.d.ts (hanya file .d.ts per modul), sehingga TypeScript
 * NodeNext menolak import utamanya. Aplikasi hanya memakai OAuth2Client dan
 * verifyIdToken(), jadi shim sempit ini cukup.
 */
declare module 'google-auth-library' {
  export interface GoogleIdTokenPayload {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    given_name?: string;
    family_name?: string;
  }

  export class OAuth2Client {
    constructor(clientId?: string, clientSecret?: string, redirectUri?: string);
    verifyIdToken(options: {
      idToken: string;
      audience?: string | string[];
    }): Promise<{ getPayload(): GoogleIdTokenPayload | undefined }>;
  }
}
