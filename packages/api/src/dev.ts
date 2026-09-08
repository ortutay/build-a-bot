import { API } from './API.js';

const api = new API({ services: [] });
const server = await api.start();

console.log(`Build-A-Bot API listening on http://localhost:${server.port}`);
