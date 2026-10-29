import { describe, expect, it } from 'vitest';
import { signOAuthState, verifyOAuthState } from '../src/utils/oauth-state.util.js';

describe('OAuth state (Instagram)', () => {
  it('menerima state yang ditandatangani dan mengembalikan payload aslinya', () => {
    const state = signOAuthState({ userId: 'usr_1', baseHandle: '@base', origin: 'connections' });
    const payload = verifyOAuthState(state);

    expect(payload).toMatchObject({
      purpose: 'instagram_oauth',
      userId: 'usr_1',
      baseHandle: '@base',
      origin: 'connections',
    });
    expect(payload?.nonce).toBeTruthy();
  });

  // Serangan utama SEC-01: penyerang membuat state sendiri yang menunjuk
  // user lain, lalu callback menerbitkan sesi untuk user tersebut.
  it('menolak state yang isinya diubah tanpa tanda tangan sah', () => {
    const forged = Buffer.from(
      JSON.stringify({
        purpose: 'instagram_oauth',
        userId: 'usr_victim',
        baseHandle: '',
        origin: 'login',
        nonce: 'abc',
        exp: Math.floor(Date.now() / 1000) + 600,
      })
    ).toString('base64url');

    expect(verifyOAuthState(forged)).toBeNull();
    expect(verifyOAuthState(`${forged}.${'A'.repeat(43)}`)).toBeNull();
  });

  it('menolak state base64 lama tanpa tanda tangan (format sebelum perbaikan)', () => {
    const legacy = Buffer.from(JSON.stringify({ userId: 'usr_victim', origin: 'login' })).toString(
      'base64url'
    );

    expect(verifyOAuthState(legacy)).toBeNull();
  });

  it('menolak state kedaluwarsa', () => {
    const state = signOAuthState({ userId: 'usr_1' }, -1);
    expect(verifyOAuthState(state)).toBeNull();
  });

  it('menolak string kosong atau payload bertanda tangan yang salah bentuk', () => {
    expect(verifyOAuthState('')).toBeNull();
    expect(verifyOAuthState('hanya-body-tanpa-titik')).toBeNull();
  });

  it('nonce berbeda setiap kali state dibuat', () => {
    const a = verifyOAuthState(signOAuthState({ userId: 'usr_1' }));
    const b = verifyOAuthState(signOAuthState({ userId: 'usr_1' }));

    expect(a?.nonce).not.toBe(b?.nonce);
  });
});
