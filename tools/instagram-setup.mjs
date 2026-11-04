// Bir kez çalıştırılır: Graph API Explorer'dan alınan kısa ömürlü anahtarı kalıcı sayfa anahtarına çevirir,
// Instagram hesap kimliğini bulur ve GitHub'a secret olarak girilecek değerleri yazar.
//
//   node tools/instagram-setup.mjs --app-id 123 --app-secret abc --token EAAB...
//
// Çıktı: IG_USER_ID ve IG_ACCESS_TOKEN (Facebook Sayfası anahtarı; uzun ömürlü kullanıcı anahtarından
// türetildiği için süresi dolmaz). Hiçbir şey kaydedilmez, değerler sadece ekrana yazılır.

const API = "https://graph.facebook.com/v21.0";
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const appId = option("app-id");
const appSecret = option("app-secret");
const shortToken = option("token");
if (!appId || !appSecret || !shortToken) {
    console.error("Kullanım: node tools/instagram-setup.mjs --app-id ... --app-secret ... --token ...");
    process.exit(1);
}

async function get(path, params) {
    const url = new URL(`${API}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`${path}: ${data.error ? data.error.message : response.status}`);
    return data;
}

// 1) Kısa ömürlü (1 saat) -> uzun ömürlü (60 gün) kullanıcı anahtarı
const long = await get("oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken });
console.log("Uzun ömürlü kullanıcı anahtarı alındı.");

// 2) Kullanıcının sayfaları; Instagram hesabı bağlı olanı seç
const pages = await get("me/accounts", { fields: "id,name,access_token,instagram_business_account", access_token: long.access_token });
const page = (pages.data || []).find(p => p.instagram_business_account);
if (!page) {
    console.error("Instagram hesabı bağlı bir Facebook Sayfası bulunamadı. Sayfalar:", (pages.data || []).map(p => p.name).join(", ") || "(yok)");
    console.error("Instagram > Ayarlar > Profesyonel pano > Facebook Sayfası bağla adımını kontrol et; sonra Graph API Explorer'dan yeni anahtar al.");
    process.exit(1);
}

// 3) Instagram hesabını doğrula
const ig = await get(page.instagram_business_account.id, { fields: "username,followers_count,media_count", access_token: page.access_token });
console.log(`Sayfa: ${page.name} · Instagram: @${ig.username} (${ig.followers_count} takipçi, ${ig.media_count} gönderi)`);

// 4) Anahtarın süresi: sayfa anahtarları uzun ömürlü kullanıcı anahtarından geldiğinde süresizdir
const debug = await get("debug_token", { input_token: page.access_token, access_token: `${appId}|${appSecret}` });
const expires = debug.data && debug.data.expires_at ? new Date(debug.data.expires_at * 1000).toISOString() : "süresiz";
console.log(`Anahtar süresi: ${expires}`);

console.log("\nGitHub > Settings > Secrets and variables > Actions > New repository secret:");
console.log(`IG_USER_ID=${page.instagram_business_account.id}`);
console.log(`IG_ACCESS_TOKEN=${page.access_token}`);
