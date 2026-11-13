import { createApp } from './app.mjs';

const app = createApp();
const port = await app.listen();
console.log(`Coinjar is listening on http://127.0.0.1:${port}`);
