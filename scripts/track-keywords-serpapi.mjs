import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
      // Only ignore "file not found" errors; re-throw other errors
      throw error;
    }
    // .env.local does not exist; continue with empty env object
  }
  return env;
}

const envPath = path.join(__dirname, '..', '.env.local');
const env = loadEnv(envPath);

// Load Supabase credentials from environment or .env.local
// Precedence: process.env > .env.local
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔐 Supabase URL:', SUPABASE_URL ? '✅ Loaded' : '❌ Missing');
console.log('🔑 Supabase Key:', SUPABASE_ANON_KEY ? '✅ Loaded' : '❌ Missing');

// Load SerpAPI key from environment or .env.local
// Precedence: process.env > .env.local
const SERPAPI_KEY = process.env.SERPAPI_API_KEY || env.SERPAPI_API_KEY;

console.log('🔍 SerpAPI Key:', SERPAPI_KEY ? '✅ Loaded' : '❌ Missing (set SERPAPI_API_KEY in .env.local or environment)');

// Exit early if required credentials are missing
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Error: Supabase credentials are not set.');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in:');
  console.error('  - System environment variables, or');
  console.error('  - .env.local file (NEXT_PUBLIC_SUPABASE_URL=..., NEXT_PUBLIC_SUPABASE_ANON_KEY=...)');
  process.exit(1);
}

if (!SERPAPI_KEY) {
  console.error('❌ Error: SERPAPI_API_KEY is not set.');
  console.error('Please set SERPAPI_API_KEY in:');
  console.error('  - System environment variable, or');
  console.error('  - .env.local file (SERPAPI_API_KEY=your_key_here)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Load keywords
const keywordsPath = path.join(__dirname, '..', 'public', 'keywords.json');
const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

async function getKeywordPosition(keyword, targetDomain) {
  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        q: keyword,
        api_key: SERPAPI_KEY,
        engine: 'google',
        google_domain: 'google.es',
        hl: 'es',
        gl: 'es',
        num: 100, // Get more results to find position
      },
    });

    const results = response.data.organic_results || [];

    // Find the position of our domain
    for (let i = 0; i < results.length; i++) {
      const link = results[i].link || '';
      if (link.includes(targetDomain)) {
        return i + 1; // Position (1-based)
      }
    }

    return 0; // Not found in top 100
  } catch (error) {
    console.error(`  ❌ SerpAPI Error for "${keyword}":`, error.message);
    return 0;
  }
}

async function trackKeywords() {
  console.log('\n🔍 Starting SerpAPI keyword tracking...\n');

  const timestamp = new Date();
  let tracked = 0;
  let errors = 0;

  for (const kw of keywords) {
    console.log(`📍 Tracking: "${kw.keyword}" (${kw.domain})...`);

    const position = await getKeywordPosition(kw.keyword, kw.domain);

    const { error } = await supabase.from('keyword_tracking').insert([
      {
        keyword_id: kw.id,
        position: position,
        timestamp: timestamp.toISOString(),
        domain: kw.domain,
      },
    ]);

    if (error) {
      console.error(`  ❌ Supabase Error:`, error.message);
      errors++;
    } else {
      console.log(`  ✅ Position: ${position}\n`);
      tracked++;
    }

    // Wait between requests (respeta rate limits de SerpAPI)
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Completed: ${tracked} tracked, ${errors} errors\n`);
}

trackKeywords().catch(console.error);
