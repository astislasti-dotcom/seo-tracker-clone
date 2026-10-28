import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
function loadEnv(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      env[key.trim()] = valueParts.join('=').trim();
    }
  }
  return env;
}

const envPath = path.join(__dirname, '..', '.env.local');
const env = loadEnv(envPath);

console.log('🔐 Supabase URL:', env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Loaded' : '❌ Missing');
console.log('🔑 Supabase Key:', env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Loaded' : '❌ Missing');
console.log('🔍 SerpAPI Key:', process.env.SERPAPI_KEY ? '✅ Loaded' : '❌ Missing (use env var)');

const SERPAPI_KEY = '394168ca7463b29536594fc9f47b7a822a4db657e5426b1acc89f994dfe7e2f1';

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
