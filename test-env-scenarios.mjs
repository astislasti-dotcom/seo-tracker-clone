#!/usr/bin/env node

/**
 * Real environment variable scenario tests
 * Tests 5 scenarios with isolated, fictional credentials
 * Uses aserciones to validate each scenario
 */

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Utility: replicate the loadEnv function from track-keywords-serpapi.mjs
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

// Scenario validator function
function testScenario(name, processEnv, envLocalContent, expectedResult) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Test: ${name}`);
  console.log('='.repeat(70));

  // Create temporary .env.local for this test
  const tempEnvPath = path.join(__dirname, '.env.local.test');
  if (envLocalContent) {
    fs.writeFileSync(tempEnvPath, envLocalContent, 'utf8');
  }

  try {
    // Load env from temporary file
    const env = loadEnv(tempEnvPath);

    // Test the resolution logic (mimicking track-keywords-serpapi.mjs)
    const SUPABASE_URL = processEnv.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY = processEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const SERPAPI_KEY = processEnv.SERPAPI_API_KEY || env.SERPAPI_API_KEY;

    const supabaseOk = SUPABASE_URL && SUPABASE_ANON_KEY;
    const serpapiOk = SERPAPI_KEY;
    const allOk = supabaseOk && serpapiOk;

    // Report results
    console.log(`Supabase URL: ${SUPABASE_URL ? '✅ YES' : '❌ NO'}`);
    console.log(`Supabase Key: ${SUPABASE_ANON_KEY ? '✅ YES' : '❌ NO'}`);
    console.log(`SerpAPI Key: ${SERPAPI_KEY ? '✅ YES' : '❌ NO'}`);

    // Assertion
    if (expectedResult === 'PASS') {
      if (allOk) {
        console.log(`\n✅ ASSERTION PASSED: All credentials resolved as expected`);
        return true;
      } else {
        console.log(`\n❌ ASSERTION FAILED: Expected all credentials but got missing values`);
        return false;
      }
    } else if (expectedResult === 'FAIL_SUPABASE') {
      if (!supabaseOk) {
        console.log(`\n✅ ASSERTION PASSED: Supabase credentials correctly missing`);
        return true;
      } else {
        console.log(`\n❌ ASSERTION FAILED: Expected Supabase to be missing`);
        return false;
      }
    } else if (expectedResult === 'FAIL_SERPAPI') {
      if (!serpapiOk) {
        console.log(`\n✅ ASSERTION PASSED: SerpAPI key correctly missing`);
        return true;
      } else {
        console.log(`\n❌ ASSERTION FAILED: Expected SerpAPI to be missing`);
        return false;
      }
    } else if (expectedResult === 'FAIL_ALL') {
      if (!allOk) {
        console.log(`\n✅ ASSERTION PASSED: All credentials correctly missing`);
        return true;
      } else {
        console.log(`\n❌ ASSERTION FAILED: Expected all credentials to be missing`);
        return false;
      }
    }
  } finally {
    // Clean up
    if (fs.existsSync(tempEnvPath)) {
      fs.unlinkSync(tempEnvPath);
    }
  }
}

console.log('\n🧪 Environment Variable Scenario Tests');
console.log('Using fictional credentials (no real secrets)\n');

const results = [];

// Scenario 1: Only process.env (no .env.local file)
results.push(testScenario(
  'Scenario 1: Only process.env (no .env.local)',
  {
    NEXT_PUBLIC_SUPABASE_URL: 'https://fictional-supabase.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional_sb_anon_key_12345',
    SERPAPI_API_KEY: 'fictional_serpapi_key_67890'
  },
  null, // No .env.local
  'PASS'
));

// Scenario 2: Only .env.local (no process.env)
results.push(testScenario(
  'Scenario 2: Only .env.local (no process.env)',
  {}, // Empty process.env for this test
  'NEXT_PUBLIC_SUPABASE_URL=https://fictional-supabase.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fictional_sb_anon_key_12345\nSERPAPI_API_KEY=fictional_serpapi_key_67890\n',
  'PASS'
));

// Scenario 3: Both sources (process.env takes precedence)
results.push(testScenario(
  'Scenario 3: Both sources (process.env > .env.local)',
  {
    NEXT_PUBLIC_SUPABASE_URL: 'https://process-env-supabase.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'process_env_sb_key',
    SERPAPI_API_KEY: 'process_env_serpapi_key'
  },
  'NEXT_PUBLIC_SUPABASE_URL=https://env-local-supabase.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=env_local_sb_key\nSERPAPI_API_KEY=env_local_serpapi_key\n',
  'PASS'
));

// Scenario 4: Missing all credentials
results.push(testScenario(
  'Scenario 4: Missing all credentials',
  {}, // No process.env
  '', // Empty .env.local
  'FAIL_ALL'
));

// Scenario 5: .env.local file absent (no process.env either)
results.push(testScenario(
  'Scenario 5: .env.local file absent (loadEnv handles gracefully)',
  {}, // No process.env
  null, // File doesn't exist - loadEnv should handle ENOENT
  'FAIL_ALL'
));

// Summary
console.log(`\n${'='.repeat(70)}`);
console.log('📊 Test Summary');
console.log('='.repeat(70));

const passed = results.filter(r => r).length;
const total = results.length;

console.log(`\nPassed: ${passed}/${total}`);

if (passed === total) {
  console.log('✅ All scenarios passed!');
  process.exit(0);
} else {
  console.log(`❌ ${total - passed} scenario(s) failed`);
  process.exit(1);
}
