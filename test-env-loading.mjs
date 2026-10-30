#!/usr/bin/env node

/**
 * Test suite for environment variable loading
 * Tests SERPAPI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * WITHOUT making actual API calls or database insertions
 */

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env from .env.local file (if it exists)
function loadEnv(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return env;
}

console.log('\n🧪 Environment Variable Loading Test Suite\n');
console.log('='.repeat(60));

const envPath = path.join(__dirname, '.env.local');
const env = loadEnv(envPath);

// Test 1: Load from .env.local
console.log('\n✅ Test 1: Loading from .env.local');
console.log('-'.repeat(60));
if (Object.keys(env).length > 0) {
  console.log(`Found ${Object.keys(env).length} variables in .env.local:`);
  Object.keys(env).forEach(key => {
    // Only show variable names, not values (to avoid exposing secrets)
    console.log(`  • ${key}`);
  });
} else {
  console.log('No .env.local file or file is empty');
}

// Test 2: Simulate loading with precedence (process.env > .env.local)
console.log('\n✅ Test 2: Environment Variable Precedence (process.env > .env.local)');
console.log('-'.repeat(60));

const testVars = [
  'SERPAPI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
];

const results = {};
let allPresent = true;

testVars.forEach(varName => {
  const fromProcess = process.env[varName];
  const fromEnvLocal = env[varName];
  const final = fromProcess || fromEnvLocal;

  results[varName] = {
    process: !!fromProcess,
    envLocal: !!fromEnvLocal,
    final: !!final,
    source: fromProcess ? 'process.env (precedence)' : fromEnvLocal ? '.env.local' : 'NOT SET'
  };

  const status = final ? '✅' : '❌';
  console.log(`\n${status} ${varName}`);
  console.log(`   From process.env: ${fromProcess ? 'YES' : 'NO'}`);
  console.log(`   From .env.local: ${fromEnvLocal ? 'YES' : 'NO'}`);
  console.log(`   Final source: ${results[varName].source}`);
  // NOTE: NOT printing any secret values, even masked or partial

  if (!final) {
    allPresent = false;
  }
});

// Test 3: Validation logic
console.log('\n✅ Test 3: Validation Logic');
console.log('-'.repeat(60));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERPAPI_KEY = process.env.SERPAPI_API_KEY || env.SERPAPI_API_KEY;

const supabaseOk = SUPABASE_URL && SUPABASE_ANON_KEY;
const serpapiOk = SERPAPI_KEY;

console.log(`Supabase ready: ${supabaseOk ? '✅ YES' : '❌ NO'}`);
if (!supabaseOk) {
  if (!SUPABASE_URL) console.log('  - Missing: NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) console.log('  - Missing: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

console.log(`SerpAPI ready: ${serpapiOk ? '✅ YES' : '❌ NO'}`);
if (!serpapiOk) {
  console.log('  - Missing: SERPAPI_API_KEY');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 Summary\n');

if (supabaseOk && serpapiOk) {
  console.log('✅ All credentials loaded successfully!');
  console.log('Script can proceed with actual operations.');
  process.exit(0);
} else {
  console.log('❌ Some credentials are missing:');
  if (!supabaseOk) {
    console.log('   Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (!serpapiOk) {
    console.log('   Please set SERPAPI_API_KEY');
  }
  console.log('\nYou can set these in:');
  console.log('   - .env.local file (copy .env.example if you have one)');
  console.log('   - System environment variables (export VAR_NAME=value)');
  process.exit(1);
}
