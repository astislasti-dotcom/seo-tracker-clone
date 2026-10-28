import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SERPAPI_KEY = process.env.SERPAPI_API_KEY;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
        num: 100,
      },
    });

    const results = response.data.organic_results || [];

    for (let i = 0; i < results.length; i++) {
      const link = results[i].link || '';
      if (link.includes(targetDomain)) {
        return i + 1;
      }
    }

    return 0;
  } catch (error) {
    console.error(`Error for "${keyword}":`, error.message);
    return 0;
  }
}

export default async function handler(req, res) {
  // Verify cron secret
  const cronSecret = req.headers['authorization'];
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Load keywords from public folder
    const keywordsPath = path.join(process.cwd(), 'public', 'keywords.json');
    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

    console.log('🔍 Starting daily keyword tracking...');

    const timestamp = new Date();
    let tracked = 0;
    let errors = 0;

    for (const kw of keywords) {
      console.log(`Tracking: "${kw.keyword}"...`);

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
        console.error(`Error saving ${kw.keyword}:`, error.message);
        errors++;
      } else {
        tracked++;
      }

      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Completed: ${tracked} tracked, ${errors} errors`);

    return res.status(200).json({
      success: true,
      message: `Tracked ${tracked} keywords, ${errors} errors`,
      timestamp: timestamp.toISOString(),
    });
  } catch (error) {
    console.error('Tracking error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
