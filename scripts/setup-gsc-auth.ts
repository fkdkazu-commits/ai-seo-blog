/**
 * Google Search Console OAuth2 認証セットアップ
 *
 * 事前準備:
 *   C:\Users\fkdka\.secrets\gsc-client.json に以下の形式で保存
 *   { "client_id": "...", "client_secret": "..." }
 *
 * 実行:
 *   npx tsx scripts/setup-gsc-auth.ts
 *
 * 完了後:
 *   C:\Users\fkdka\.secrets\gsc-tokens.json に refresh_token が保存される
 */
import { google } from 'googleapis';
import fs from 'fs/promises';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const SECRETS_DIR = 'C:\\Users\\fkdka\\.secrets';
const CLIENT_FILE = `${SECRETS_DIR}\\gsc-client.json`;
const TOKENS_FILE = `${SECRETS_DIR}\\gsc-tokens.json`;

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

async function main() {
  let clientJson: { client_id: string; client_secret: string };
  try {
    const raw = await fs.readFile(CLIENT_FILE, 'utf-8');
    clientJson = JSON.parse(raw);
  } catch {
    console.error(`エラー: ${CLIENT_FILE} が見つかりません。`);
    console.error('以下の形式で作成してください:');
    console.error('{ "client_id": "...", "client_secret": "..." }');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    clientJson.client_id,
    clientJson.client_secret,
    'urn:ietf:wg:oauth:2.0:oob'  // コピー&ペースト用リダイレクトURI
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',  // refresh_token を確実に取得するために毎回同意画面を表示
  });

  console.log('\n以下のURLをブラウザで開いてGoogleアカウントにログインしてください:');
  console.log('\n' + authUrl + '\n');

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question('ブラウザに表示されたコードを貼り付けてください: ')).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error('エラー: refresh_token が取得できませんでした。');
    console.error('既にこのアカウントで認証済みの場合は、Google アカウントのアクセス権限ページ');
    console.error('( https://myaccount.google.com/permissions ) でこのアプリのアクセスを削除してから再試行してください。');
    process.exit(1);
  }

  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  console.log(`\n認証完了！トークンを保存しました: ${TOKENS_FILE}`);
  console.log('\n次のコマンドで分析を実行できます:');
  console.log('  npm run analyze');
}

main().catch(console.error);
