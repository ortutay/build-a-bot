import { existsSync } from 'fs';
import { loadEnvFile } from 'process';

if (existsSync('.env')) {
  loadEnvFile('.env');
}
