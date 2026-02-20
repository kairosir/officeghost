#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const mode = process.argv[2] || 'dev';
const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
const cargoBin = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

const env = { ...process.env };
const entries = [];

if (process.platform === 'win32') {
  const profile = env.USERPROFILE || os.homedir();
  entries.push(path.join(profile, '.cargo', 'bin'));
} else {
  const home = env.HOME || os.homedir();
  entries.push(path.join(home, '.cargo', 'bin'));
}

const originalPath = env.PATH || '';
env.PATH = [...entries, originalPath].filter(Boolean).join(path.delimiter);

const args = [mode === 'build' ? 'build' : 'dev'];
const indexerArgs = [
  'build',
  '--manifest-path',
  path.join('rust-indexer', 'Cargo.toml'),
  mode === 'build' ? '--release' : '--quiet'
].filter(Boolean);

const runTauri = () => {
  const child = spawn(tauriBin, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('Failed to run tauri:', err.message);
    process.exit(1);
  });
};

const indexerBuild = spawn(cargoBin, indexerArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
indexerBuild.on('exit', (code) => {
  if ((code ?? 1) !== 0) {
    console.error('Failed to build rust-indexer sidecar');
    process.exit(code ?? 1);
  }
  runTauri();
});
indexerBuild.on('error', (err) => {
  console.error('Failed to run cargo for rust-indexer:', err.message);
  process.exit(1);
});
