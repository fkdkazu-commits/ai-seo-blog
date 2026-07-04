/**
 * Google Search Console分析スクリプト
 * CTR・順位・表示回数を取得し、リライト候補をJSONで出力する
 *
 * 判定ロジックの参考:
 * - First Page Sage (2026): 順位別期待CTR
 * - Backlinko: 期待CTRの30%以上乖離でタイトル改善候補
 * - SurferSEO: 公開3ヶ月以上経過 & 低インプレッションは再最適化対象
 * - SEO業界通則: 11〜30位(2〜3ページ目)が最優先リライト対象（Quick Win）
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
  reason: 'low-ctr' | 'rank-drop' | 'impression-surge' | 'no-traction';
  metrics: PageMetrics;
}

// First Page Sage 2026 データに基づく順位別期待CTR（%）
const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 28, 2: 15, 3: 11, 4: 8, 5: 7,
  6: 6,  7: 5,  8: 4,  9: 3.5, 10: 3,
};

function getExpectedCtr(position: number): number {
  const rounded = Math.round(position);
  if (rounded <= 1)  return EXPECTED_CTR_BY_POSITION[1];
  if (rounded >= 10) return EXPECTED_CTR_BY_POSITION[10];
  return EXPECTED_CTR_BY_POSITION[rounded] ?? 3;
}

const SECRETS_DIR = 'C:\\Users\\fkdka\\.secrets';

async function buildAuth() {
  const clientFile = `${SECRETS_DIR}\\gsc-client.json`;
  const tokensFile = `${SECRETS_DIR}\\gsc-tokens.json`;

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
  throw new Error('分析対象サイトが設定されていません。');
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

// MDXファイルのfrontmatterからslug→pubDateのマップを作成
async function buildPubDateMap(): Promise<Map<string, Date>> {
  const blogDir = path.join(ROOT, 'src', 'content', 'blog');
  const map = new Map<string, Date>();
  try {
    const files = await fs.readdir(blogDir);
    for (const file of files) {
      if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
      const slug = file.replace(/\.(mdx|md)$/, '');
      const content = await fs.readFile(path.join(blogDir, file), 'utf-8');
      const match = content.match(/^pubDate:\s*(.+)$/m);
      if (match) {
        const date = new Date(match[1].trim());
        if (!isNaN(date.getTime())) map.set(slug, date);
      }
    }
  } catch {
    // blogディレクトリが読めない場合はスキップ
  }
  return map;
}

function detectCandidates(
  metrics: PageMetrics[],
  pubDateMap: Map<string, Date>
): RewriteCandidate[] {
  const candidates: RewriteCandidate[] = [];
  const now = new Date();
  const gscPageSet = new Set(metrics.map(m => m.page));

  // GSCに出ていない記事（表示回数0）を公開日マップから検出
  for (const [slug, pubDate] of pubDateMap.entries()) {
    const daysSincePublish = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePublish < 90) continue; // 3ヶ月未満は除外
    // GSCデータに含まれているか確認（含まれていれば後述のループで処理）
    const matched = [...gscPageSet].some(p => p.includes(`/blog/${slug}`));
    if (!matched) {
      // GSCに一切出ていない = インプレッション0
      candidates.push({
        page: `/blog/${slug}`,
        reason: 'no-traction',
        metrics: { page: `/blog/${slug}`, clicks: 0, impressions: 0, ctr: 0, position: 0 },
      });
    }
  }

  for (const m of metrics) {
    // /blog/ や /blog など記事一覧・非記事ページを除外
    const slug = m.page.replace(/.*\/blog\/([^/]+)\/?$/, '$1');
    if (!slug || slug === m.page || m.page.match(/\/blog\/?$/)) continue;

    const pubDate = pubDateMap.get(slug);
    const daysSincePublish = pubDate
      ? (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    // 優先度1: Quick Win（2〜3ページ目）
    // 根拠: Googleが関連性を認めているため少しの改善でpage1入りが期待できる
    if (m.position > 10 && m.position <= 30 && m.impressions >= 50) {
      candidates.push({ page: m.page, reason: 'rank-drop', metrics: m });
      continue;
    }

    // 優先度2: CTR改善（1〜10位だがCTRが期待値の70%未満）
    // 根拠: Backlinko「期待CTRの30%以上乖離はタイトル・メタディスクリプション要改善」
    if (m.position <= 10 && m.impressions >= 100) {
      const expectedCtr = getExpectedCtr(m.position);
      if (m.ctr < expectedCtr * 0.7) {
        candidates.push({ page: m.page, reason: 'low-ctr', metrics: m });
        continue;
      }
    }

    // 優先度3: 低インプレッション（公開3ヶ月以上 & 表示50回未満）
    // 根拠: SurferSEO「3ヶ月経っても低インプレッションは内容・構造の見直しが必要」
    if (daysSincePublish >= 90 && m.impressions < 50) {
      candidates.push({ page: m.page, reason: 'no-traction', metrics: m });
      continue;
    }

    // 優先度4: 関連記事候補（表示回数急増）
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

  const pubDateMap = await buildPubDateMap();
  console.log(`記事公開日マップ: ${pubDateMap.size}件`);

  const candidates = detectCandidates(metrics, pubDateMap);
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
