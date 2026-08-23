// ---------- Autenticación real (Supabase Auth) ----------
// Reemplaza la cortina de JavaScript por login real: las contraseñas nunca
// pasan por este archivo en texto plano ni se guardan aquí — Supabase las
// verifica en su propio servidor y solo entrega un token de sesión.
(function () {
'use strict';

const SUPABASE_URL = 'https://jetlojzwykbbouarwumk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8g9UzL94I7taH46nD9e7vw_91MD2ubJ';

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// El acceso es solo por invitación (un admin invita desde el panel de Supabase).
// Si la persona llega desde el enlace de invitación, la URL trae un token —
// como flujo "implícito" en el hash (#access_token=...&type=invite) o como
// flujo PKCE en la query (?code=...&type=invite) según la configuración del
// proyecto — antes de que supabase-js lo procese. Lo capturamos aquí (revisando
// ambos lugares) para saber si debemos pedirle que cree su contraseña en vez
// de mostrarle el formulario de ingreso normal.
const _hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
const _searchParams = new URLSearchParams(window.location.search || '');
const PENDING_AUTH_TYPE = _hashParams.get('type') || _searchParams.get('type') || null;
const CAME_FROM_AUTH_LINK = !!(PENDING_AUTH_TYPE || _hashParams.get('access_token') || _searchParams.get('code'));

async function setPassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await client.auth.signOut();
}

async function getSession() {
  const { data } = await client.auth.getSession();
  return data.session || null;
}

// Perfil (rol) del usuario autenticado. Si su fila fue borrada (acceso
// revocado por un admin) esto devuelve null aunque su sesión siga viva.
async function getMyProfile() {
  const { data: userData } = await client.auth.getUser();
  const user = userData && userData.user;
  if (!user) return null;
  const { data, error } = await client.from('profiles').select('id,email,role').eq('id', user.id).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function listProfiles() {
  const { data, error } = await client.from('profiles').select('id,email,role,created_at').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function updateProfileRole(id, role) {
  const { error } = await client.from('profiles').update({ role }).eq('id', id);
  if (error) throw error;
}

async function removeProfile(id) {
  const { error } = await client.from('profiles').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Conciliación (tabla compartida) ----------
async function loadConciliacionRemote() {
  const { data, error } = await client.from('conciliacion').select('codigo,conciliado');
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.codigo] = r.conciliado ? 'SI' : 'NO'; });
  return map;
}

async function setConciliacion(codigo, conciliado) {
  const { data: userData } = await client.auth.getUser();
  const uid = userData && userData.user ? userData.user.id : null;
  const { error } = await client.from('conciliacion').upsert({ codigo, conciliado, updated_by: uid, updated_at: new Date().toISOString() });
  if (error) throw error;
}

window.CTAuth = {
  signIn, signOut, getSession, getMyProfile, setPassword,
  listProfiles, updateProfileRole, removeProfile,
  loadConciliacionRemote, setConciliacion,
  pendingAuthType: PENDING_AUTH_TYPE,
  cameFromAuthLink: CAME_FROM_AUTH_LINK,
  onAuthStateChange: (cb) => client.auth.onAuthStateChange(cb),
};
})();
