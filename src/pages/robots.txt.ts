import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const content = [
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: https://fkdkazu-commits.github.io/ai-seo-blog/sitemap.xml',
  ].join('\n');

  return new Response(content, { headers: { 'Content-Type': 'text/plain' } });
};
