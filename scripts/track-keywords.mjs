import { chromium } from 'playwright';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');

// Read .env.local manually
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

const env = loadEnv(envPath);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔐 Supabase URL:', SUPABASE_URL ? '✅ Loaded' : '❌ Missing');
console.log('🔑 Supabase Key:', SUPABASE_KEY ? '✅ Loaded' : '❌ Missing');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Load keywords
const keywordsPath = path.join(__dirname, '..', 'public', 'keywords.json');
const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

const DOMAINS = ['3av.events', 'astisl.es'];

async function searchKeywordOnGoogle(keyword) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle' });

    const results = await page.$$eval('a[href^="https://"]', (links) => {
      return links.map((link) => {
        const href = link.getAttribute('href');
        try {
          const url = new URL(href);
          return url.hostname.replace('www.', '');
        } catch {
          return null;
        }
      }).filter(Boolean);
    });

    const positions = {};
    for (const domain of ['3av.events', 'astisl.es']) {
      positions[domain] = results.findIndex((r) => r.includes(domain)) + 1 || 0;
    }

    await browser.close();
    return positions;
  } catch (error) {
    console.error(`Error searching "${keyword}":`, error.message);
    await browser.close();
    return {};
  }
}

async function trackKeywords() {
  console.log('\n🔍 Starting keyword tracking...\n');

  const timestamp = new Date();

  for (const kw of keywords.slice(0, 3)) { // Test with first 3 keywords
    console.log(`📍 Tracking: "${kw.keyword}" (${kw.domain})...`);

    const positions = await searchKeywordOnGoogle(kw.keyword);
    const position = positions[kw.domain] || 0;

    const { error } = await supabase.from('keyword_tracking').insert([
      {
        keyword_id: kw.id,
        domain: kw.domain,
        position: position,
        timestamp: timestamp.toISOString(),
      },
    ]);

    if (error) {
      console.error(`  ❌ Error:`, error.message);
    } else {
      console.log(`  ✅ Position: ${position}\n`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('✅ Keyword tracking completed!');
}

trackKeywords().catch(console.error);
