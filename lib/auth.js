const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1050997448113-b4oh78kc2raddk9h4fjrqbmiito67set.apps.googleusercontent.com';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'hgpark@goldenrabbit.co.kr').toLowerCase();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '11HHSbLyNWPKeZdFbS89uulmfBbcE7O64Xxh6IswNdhI';
const APPROVAL_SHEET_NAME = process.env.GOOGLE_APPROVAL_SHEET_NAME || 'approvals';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return value;
  }
  return '';
}

function bearerTokenFromHeaders(headers) {
  const authorization = getHeader(headers, 'authorization');
  const match = String(authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function verifyGoogleCredential(credential) {
  if (!credential) throw new Error('Google 로그인 토큰이 없습니다.');

  const url = new URL('https://oauth2.googleapis.com/tokeninfo');
  url.searchParams.set('id_token', credential);

  const response = await fetch(url);
  const profile = await response.json();

  if (!response.ok) {
    throw new Error(profile.error_description || 'Google 로그인 토큰을 확인하지 못했습니다.');
  }

  if (profile.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Google OAuth 클라이언트 ID가 일치하지 않습니다.');
  }

  if (profile.email_verified !== 'true' && profile.email_verified !== true) {
    throw new Error('Google 이메일 인증이 완료되지 않은 계정입니다.');
  }

  return {
    email: String(profile.email || '').toLowerCase(),
    name: profile.name || '',
    picture: profile.picture || ''
  };
}

function isApprovedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['approved', 'approve', 'allow', 'allowed', 'true', 'yes', 'y', '1', '승인', '허가'].includes(status);
}

async function fetchApprovedEmails() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('sheet', APPROVAL_SHEET_NAME);

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return new Set();

  const csv = await response.text();
  const rows = parseCsv(csv);
  const header = rows.shift() || [];
  const emailIndex = header.findIndex((column) => ['email', '이메일', '계정'].includes(column.trim().toLowerCase()));
  const statusIndex = header.findIndex((column) => ['status', '상태', '승인'].includes(column.trim().toLowerCase()));

  if (emailIndex === -1) return new Set();

  const approved = new Set();
  for (const row of rows) {
    const email = String(row[emailIndex] || '').trim().toLowerCase();
    const status = statusIndex === -1 ? 'approved' : row[statusIndex];
    if (email && isApprovedStatus(status)) approved.add(email);
  }
  return approved;
}

async function verifyApprovedCredential(credential) {
  const user = await verifyGoogleCredential(credential);
  if (user.email === ADMIN_EMAIL) return { approved: true, role: 'admin', user };

  const approvedEmails = await fetchApprovedEmails();
  if (approvedEmails.has(user.email)) return { approved: true, role: 'approved', user };

  return { approved: false, role: 'pending', user };
}

async function requireApproved(headers) {
  const credential = bearerTokenFromHeaders(headers);
  if (!credential) {
    return { ok: false, statusCode: 401, error: 'Google 로그인이 필요합니다.' };
  }

  const result = await verifyApprovedCredential(credential);
  if (!result.approved) {
    return {
      ok: false,
      statusCode: 403,
      error: `${result.user.email} 계정은 아직 관리자 승인을 받지 않았습니다.`,
      user: result.user,
      role: result.role
    };
  }

  return { ok: true, statusCode: 200, user: result.user, role: result.role };
}

module.exports = {
  ADMIN_EMAIL,
  GOOGLE_CLIENT_ID,
  bearerTokenFromHeaders,
  requireApproved,
  verifyApprovedCredential
};
