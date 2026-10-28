import { chromium } from 'playwright';
import * as fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
    for (const domain of DOMAINS) {
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
  try {
    // Load keywords from JSON
    const keywordsPath = path.join(process.cwd(), 'public', 'keywords.json');
    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

    const timestamp = new Date();
    let tracked = 0;
    let errors = 0;

    for (const kw of keywords) {
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
        console.error(`Error saving ${kw.keyword}:`, error.message);
        errors++;
      } else {
        tracked++;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return {
      success: true,
      tracked,
      errors,
      timestamp: timestamp.toISOString(),
    };
  } catch (error) {
    console.error('Tracking error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

export default async function handler(req, res) {
  // Verify cron secret (optional but recommended)
  const cronSecret = req.headers['authorization'];
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await trackKeywords();

  if (result.success) {
    res.status(200).json({
      success: true,
      message: `Tracked ${result.tracked} keywords, ${result.errors} errors`,
      timestamp: result.timestamp,
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error,
    });
  }
}
