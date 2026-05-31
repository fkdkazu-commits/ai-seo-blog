/**
 * Google Search Console OAuth2 認証セットアップ
 *
 * 事前準備:
 *   C:\Users\fkdka\.secrets\gsc-client.json に以下の形式で保存
 *   { "client_id": "...", "client_secret": "..." }
 *
 *   GCPコンソールの「承認済みのリダイレクト URI」に以下を追加
 *   http://localhost:3999/oauth2callback
 *
 * 実行:
 *   npm run setup:gsc
 *
 * 完了後:
 *   C:\Users\fkdka\.secrets\gsc-tokens.json に refresh_token が保存される
 */
import { google } from 'googleapis';
import fs from 'fs/promises';
import http from 'http';

const SECRETS_DIR = 'C:\\Users\\fkdka\\.secrets';
const CLIENT_FILE = `${SECRETS_DIR}\\gsc-client.json`;
const TOKENS_FILE = `${SECRETS_DIR}\\gsc-tokens.json`;

const PORT = 3999;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
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
    REDIRECT_URI,
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  // ローカルサーバーでコールバックを受け取る
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') return;

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.end('<h1>認証キャンセル</h1><p>ウィンドウを閉じてください。</p>');
        server.close();
        reject(new Error(`認証エラー: ${error}`));
        return;
      }
      if (!code) {
        res.end('<h1>エラー</h1><p>コードが取得できませんでした。</p>');
        server.close();
        reject(new Error('認証コードが取得できませんでした'));
        return;
      }

      res.end('<h1>認証完了</h1><p>このウィンドウを閉じてターミナルを確認してください。</p>');
      server.close();
      resolve(code);
    });

    server.listen(PORT, () => {
      console.log('\n以下のURLをブラウザで開いてGoogleアカウントにログインしてください:');
      console.log('\n' + authUrl + '\n');
      console.log('ブラウザでログインすると自動的に認証が完了します...');
    });

    server.on('error', reject);
  });

  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\nエラー: refresh_token が取得できませんでした。');
    console.error('以下の手順で再試行してください:');
    console.error('1. https://myaccount.google.com/permissions を開く');
    console.error('2. このアプリのアクセスを削除する');
    console.error('3. npm run setup:gsc を再実行する');
    process.exit(1);
  }

  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  console.log(`\n認証完了！トークンを保存しました: ${TOKENS_FILE}`);
  console.log('\n次のコマンドで分析を実行できます:');
  console.log('  npm run analyze');
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
