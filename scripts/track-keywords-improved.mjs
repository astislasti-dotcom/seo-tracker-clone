import { chromium } from 'playwright';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');

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
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const keywordsPath = path.join(__dirname, '..', 'public', 'keywords.json');
const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

const DOMAINS = ['3av.events', 'astisl.es'];

async function searchKeywordOnGoogle(keyword, retries = 3) {
  let attempts = 0;

  while (attempts < retries) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=es`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for results to load
      await page.waitForSelector('div[data-sokoban-container]', { timeout: 10000 }).catch(() => null);

      // Get all result links
      const results = await page.evaluate(() => {
        const links = [];
        const elements = document.querySelectorAll('a[href^="http"]');

        for (const el of elements) {
          try {
            const href = el.getAttribute('href');
            if (!href) continue;

            // Skip Google's utility links
            if (href.includes('google.com/search') ||
                href.includes('google.com/url') ||
                href.includes('support.google') ||
                href.includes('accounts.google')) {
              continue;
            }

            const url = new URL(href);
            const domain = url.hostname.replace(/^www\./, '');

            // Only add actual results (not ads or other stuff)
            if (domain && !domain.includes('google')) {
              links.push({
                domain,
                href,
                text: el.textContent.slice(0, 100),
              });
            }
          } catch (e) {
            // Skip invalid URLs
          }
        }

        return links;
      });

      // Find positions for target domains
      const positions = {};
      for (const domain of ['3av.events', 'astisl.es']) {
        const resultIndex = results.findIndex(r => r.domain.includes(domain));
        positions[domain] = resultIndex >= 0 ? resultIndex + 1 : 0;
      }

      console.log(`✅ Found ${results.length} results`);

      await browser.close();
      return positions;

    } catch (error) {
      console.error(`Attempt ${attempts + 1} failed:`, error.message);
      attempts++;
      await browser.close();

      if (attempts < retries) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  return { '3av.events': 0, 'astisl.es': 0 };
}

async function trackKeywords() {
  console.log('\n🔍 Starting improved keyword tracking...\n');

  const timestamp = new Date();
  let tracked = 0;
  let errors = 0;

  for (const kw of keywords.slice(0, 5)) { // Test con 5 keywords
    console.log(`📍 Tracking: "${kw.keyword}" (${kw.domain})...`);

    const positions = await searchKeywordOnGoogle(kw.keyword);
    const position = positions[kw.domain] || 0;

    const { error } = await supabase.from('keyword_tracking').insert([
      {
        keyword_id: kw.id,
        position: position,
        timestamp: timestamp.toISOString(),
        domain: kw.domain,
      },
    ]);

    if (error) {
      console.error(`  ❌ Error:`, error.message);
      errors++;
    } else {
      console.log(`  ✅ Position: ${position}\n`);
      tracked++;
    }

    // Wait between requests
    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  console.log(`\n✅ Completed: ${tracked} tracked, ${errors} errors\n`);
}

trackKeywords().catch(console.error);
