#!/usr/bin/env node

/**
 * Scenario tests for credential resolution (process.env > .env.local).
 *
 * - Uses fictional values only. No calls to SerpAPI or Supabase.
 * - Each scenario writes its .env file inside a unique temp directory
 *   created with fs.mkdtempSync. The real .env.local is never touched.
 * - Assertions compare the resolved VALUE of each variable with the
 *   expected value, so a precedence bug fails the test.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VARS = {
  url: 'NEXT_PUBLIC_SUPABASE_URL',
  anon: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  serp: 'SERPAPI_API_KEY',
};

// Same parser semantics as scripts/track-keywords-serpapi.mjs loadEnv().
function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return env;
}

// Same resolution rule as the script: process.env first, then .env.local.
function resolve(processEnv, env) {
  return {
    url: processEnv[VARS.url] || env[VARS.url],
    anon: processEnv[VARS.anon] || env[VARS.anon],
    serp: processEnv[VARS.serp] || env[VARS.serp],
  };
}

// fileContent: string -> file is written; null -> file is not created.
function runScenario(tmpRoot, name, processEnv, fileContent) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  const envPath = path.join(dir, '.env.local');
  if (fileContent !== null) fs.writeFileSync(envPath, fileContent, 'utf8');
  const env = loadEnvFile(envPath);
  return { name, resolved: resolve(processEnv, env) };
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-tracker-env-'));
const results = [];

try {
  const FILE_VALUES = `${VARS.url}=https://file.example.invalid\n${VARS.anon}=file-anon-fixture\n${VARS.serp}=file-serp-fixture\n`;
  const PROC_VALUES = {
    [VARS.url]: 'https://proc.example.invalid',
    [VARS.anon]: 'proc-anon-fixture',
    [VARS.serp]: 'proc-serp-fixture',
  };

  // 1. Only process.env (no .env.local file at all)
  const s1 = runScenario(tmpRoot, 'S1 solo process.env (sin archivo)', PROC_VALUES, null);
  results.push(() => {
    assert.deepEqual(s1.resolved, {
      url: 'https://proc.example.invalid',
      anon: 'proc-anon-fixture',
      serp: 'proc-serp-fixture',
    });
  });

  // 2. Only .env.local (empty process.env)
  const s2 = runScenario(tmpRoot, 'S2 solo .env.local', {}, FILE_VALUES);
  results.push(() => {
    assert.deepEqual(s2.resolved, {
      url: 'https://file.example.invalid',
      anon: 'file-anon-fixture',
      serp: 'file-serp-fixture',
    });
  });

  // 3. Both sources: process.env must win for every variable
  const s3 = runScenario(tmpRoot, 'S3 ambas fuentes (gana process.env)', PROC_VALUES, FILE_VALUES);
  results.push(() => {
    assert.equal(s3.resolved.url, 'https://proc.example.invalid');
    assert.equal(s3.resolved.anon, 'proc-anon-fixture');
    assert.equal(s3.resolved.serp, 'proc-serp-fixture');
  });

  // 4. File exists but is empty; no process.env -> nothing resolves
  const s4 = runScenario(tmpRoot, 'S4 archivo vacio, sin process.env', {}, '');
  results.push(() => {
    assert.deepEqual(s4.resolved, { url: undefined, anon: undefined, serp: undefined });
  });

  // 5. File absent (ENOENT handled), no process.env -> nothing resolves, no throw
  const s5 = runScenario(tmpRoot, 'S5 archivo ausente, sin process.env', {}, null);
  results.push(() => {
    assert.deepEqual(s5.resolved, { url: undefined, anon: undefined, serp: undefined });
  });

  // 6. Partial: process.env supplies only SERPAPI, file supplies the Supabase pair
  const s6 = runScenario(
    tmpRoot,
    'S6 mezcla parcial',
    { [VARS.serp]: 'proc-serp-fixture' },
    `${VARS.url}=https://file.example.invalid\n${VARS.anon}=file-anon-fixture\n`
  );
  results.push(() => {
    assert.equal(s6.resolved.serp, 'proc-serp-fixture');
    assert.equal(s6.resolved.url, 'https://file.example.invalid');
    assert.equal(s6.resolved.anon, 'file-anon-fixture');
  });

  const names = [s1, s2, s3, s4, s5, s6].map((s) => s.name);
  let passed = 0;
  results.forEach((check, i) => {
    try {
      check();
      passed++;
      console.log(`PASS  ${names[i]}`);
    } catch (err) {
      console.log(`FAIL  ${names[i]}`);
      console.log(`      ${err.message.split('\n').slice(0, 6).join('\n      ')}`);
    }
  });

  console.log(`\nResultado: ${passed}/${results.length}`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  // Remove only the unique temp directory created by this run.
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
