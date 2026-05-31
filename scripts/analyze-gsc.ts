/**
 * Google Search Console分析スクリプト
 * CTR・順位・表示回数を取得し、リライト候補をJSONで出力する
 */
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

interface PageMetrics {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface RewriteCandidate {
  page: string;
  reason: 'low-ctr' | 'rank-drop' | 'impression-surge';
  metrics: PageMetrics;
}

const SECRETS_DIR = 'C:\\Users\\fkdka\\.secrets';

async function buildAuth() {
  const clientFile = `${SECRETS_DIR}\\gsc-client.json`;
  const tokensFile = `${SECRETS_DIR}\\gsc-tokens.json`;

  // ローカル実行: シークレットフォルダのファイルから認証情報を読む
  try {
    const [clientRaw, tokensRaw] = await Promise.all([
      fs.readFile(clientFile, 'utf-8'),
      fs.readFile(tokensFile, 'utf-8'),
    ]);
    const client = JSON.parse(clientRaw) as { client_id: string; client_secret: string };
    const tokens = JSON.parse(tokensRaw);
    const oauth2 = new google.auth.OAuth2(client.client_id, client.client_secret);
    oauth2.setCredentials(tokens);
    return oauth2;
  } catch {
    // CI実行: 環境変数から認証情報を取得
    if (!process.env.GSC_CLIENT_ID || !process.env.GSC_CLIENT_SECRET || !process.env.GSC_REFRESH_TOKEN) {
      throw new Error(
        'GSC認証情報が設定されていません。\n' +
        'ローカル: npm run setup:gsc を実行してください。\n' +
        'CI: GSC_CLIENT_ID / GSC_CLIENT_SECRET / GSC_REFRESH_TOKEN を設定してください。'
      );
    }
    const oauth2 = new google.auth.OAuth2(
      process.env.GSC_CLIENT_ID,
      process.env.GSC_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GSC_REFRESH_TOKEN });
    return oauth2;
  }
}

async function resolveSiteUrl(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const settingsFile = path.join(ROOT, 'data', 'gsc-settings.json');
  try {
    const raw = await fs.readFile(settingsFile, 'utf-8');
    const settings = JSON.parse(raw) as { selectedSite: string };
    if (settings.selectedSite) return settings.selectedSite;
  } catch {
    // fall through
  }
  throw new Error('分析対象サイトが設定されていません。\n' +
    'SITE_URL 環境変数を指定するか、設定画面でサイトを選択してください。');
}

async function fetchSearchConsoleData(): Promise<PageMetrics[]> {
  const auth = await buildAuth();
  const sc = google.searchconsole({ version: 'v1', auth });
  const siteUrl = await resolveSiteUrl();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 28);

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      dimensions: ['page'],
      rowLimit: 500,
    },
  });

  return (res.data.rows || []).map((row) => ({
    page: row.keys![0],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: (row.ctr ?? 0) * 100,
    position: row.position ?? 99,
  }));
}

function detectCandidates(metrics: PageMetrics[]): RewriteCandidate[] {
  const candidates: RewriteCandidate[] = [];

  for (const m of metrics) {
    // 条件1: 表示回数100以上 & CTR 1.5%未満 → タイトル改善
    if (m.impressions >= 100 && m.ctr < 1.5) {
      candidates.push({ page: m.page, reason: 'low-ctr', metrics: m });
      continue;
    }
    // 条件2: 順位が10位以下かつ表示回数50以上 → 本文リライト
    if (m.position > 10 && m.impressions >= 50) {
      candidates.push({ page: m.page, reason: 'rank-drop', metrics: m });
      continue;
    }
    // 条件3: 表示回数急増（500以上） → 関連記事生成候補
    if (m.impressions >= 500) {
      candidates.push({ page: m.page, reason: 'impression-surge', metrics: m });
    }
  }

  return candidates;
}

async function main() {
  const siteUrl = await resolveSiteUrl();
  console.log(`分析対象: ${siteUrl}`);
  console.log('Search Consoleデータ取得中...');
  const metrics = await fetchSearchConsoleData();
  console.log(`取得件数: ${metrics.length}`);

  const candidates = detectCandidates(metrics);
  console.log(`リライト候補: ${candidates.length}件`);

  const outDir = path.join(ROOT, 'data');
  await fs.mkdir(outDir, { recursive: true });

  await fs.writeFile(
    path.join(outDir, 'gsc-metrics.json'),
    JSON.stringify(metrics, null, 2),
    'utf-8'
  );

  await fs.writeFile(
    path.join(outDir, 'rewrite-candidates.json'),
    JSON.stringify(candidates, null, 2),
    'utf-8'
  );

  console.log('分析完了 → data/rewrite-candidates.json に出力');
}

main().catch(console.error);
