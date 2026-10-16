import app from '../src/app.js';

// Render canvas + menunggu container Meta FINISHED + publish bisa melewati
// batas 10 detik default Vercel Function.
export const config = { maxDuration: 60 };

export default app;
