import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Load keywords
const keywordsPath = path.join(__dirname, '..', 'public', 'keywords.json');
const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

// Load Google credentials
const credentialsPath = path.join(__dirname, '..', 'credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

async function getAccessToken() {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    jwt.sign(payload, credentials.private_key, { algorithm: 'RS256' }, (err, token) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
}

async function getSearchConsoleData(siteUrl, query) {
  try {
    const accessToken = await getAccessToken();

    const siteIdentifier = encodeURIComponent('sc-domain:' + siteUrl);
    const response = await fetch(`https://www.googleapis.com/searchconsole/v1/sites/${siteIdentifier}/searchAnalytics/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        dimensions: ['query'],
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: 'query',
                operator: 'contains',
                value: query,
              },
            ],
          },
        ],
        rowLimit: 10,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();

    if (data.rows && data.rows.length > 0) {
      return Math.round(data.rows[0].position || 0);
    }

    return 0;
  } catch (error) {
    console.error(`  ❌ GSC Error for "${query}":`, error.message);
    return 0;
  }
}

async function trackKeywords() {
  console.log('\n🔍 Starting GSC keyword tracking...\n');

  const timestamp = new Date();
  let tracked = 0;
  let errors = 0;

  // Group keywords by domain
  const keywordsByDomain = {};
  for (const kw of keywords) {
    if (!keywordsByDomain[kw.domain]) {
      keywordsByDomain[kw.domain] = [];
    }
    keywordsByDomain[kw.domain].push(kw);
  }

  // Track for each domain
  for (const [domain, domainKeywords] of Object.entries(keywordsByDomain)) {
    console.log(`\n📊 Tracking ${domain}...\n`);

    for (const kw of domainKeywords) {
      console.log(`📍 Tracking: "${kw.keyword}"...`);

      const position = await getSearchConsoleData(domain, kw.keyword);

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
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  console.log(`\n✅ Completed: ${tracked} tracked, ${errors} errors\n`);
}

trackKeywords().catch(console.error);
