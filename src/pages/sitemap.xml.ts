import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://fkdkazu-commits.github.io';
const BASE = '/ai-seo-blog';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export const GET: APIRoute = async () => {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  const staticPages = [
    { url: `${SITE}${BASE}/`, priority: '1.0', changefreq: 'weekly' },
    { url: `${SITE}${BASE}/blog/`, priority: '0.8', changefreq: 'daily' },
  ];

  const blogPages = posts.map((post) => ({
    url: `${SITE}${BASE}/blog/${post.slug}/`,
    lastmod: formatDate(post.data.updatedDate ?? post.data.pubDate),
    priority: '0.7',
    changefreq: 'monthly',
  }));

  const allPages = [
    ...staticPages,
    ...blogPages,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map((p) => `  <url>
    <loc>${p.url}</loc>${'lastmod' in p ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
