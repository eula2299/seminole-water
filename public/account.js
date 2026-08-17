'use strict';

(function () {
  const state = { config: null, user: null, subscription: null, googleInitialized: false, googleLoading: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lang = () => localStorage.getItem('water_lang') === 'es' ? 'es' : 'en';
  const t = (en, es) => lang() === 'es' ? (es || en) : en;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {})
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || t('Something went wrong.', 'Algo salió mal.'));
    return data;
  }

  function status(text, kind = '') {
    const el = $('#account-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = `form-status${kind ? ` ${kind}` : ''}`;
  }

  function ga(name, params = {}) {
    if (typeof window.gtag === 'function') window.gtag('event', name, { event_category: 'account', ...params });
  }

  async function loadState() {
    try { state.config = await api('/api/community/config'); }
    catch { state.config = { accounts_enabled: false, google_enabled: false, google_client_id: '' }; }
    try {
      const me = await api('/api/auth/me');
      state.user = me.user || null;
      state.subscription = me.subscription || null;
    } catch { state.user = null; state.subscription = null; }
  }

  function loadGoogleScript() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (state.googleLoading) return state.googleLoading;
    state.googleLoading = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = '1';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return state.googleLoading;
  }

  async function handleGoogleCredential(response) {
    if (!response?.credential) return status(t('Google did not return a sign-in credential.', 'Google no devolvió una credencial de acceso.'), 'error');
    status(t('Signing in with Google…', 'Ingresando con Google…'));
    try {
      const data = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      state.user = data.user;
      ga('google_sign_in_completed');
      location.href = '/account.html?google=1';
    } catch (error) {
      status(error.message, 'error');
      ga('google_sign_in_failed');
    }
  }

  async function renderGoogleSignIn() {
    const container = $('#google-primary');
    if (!container) return;
    if (!state.config?.google_enabled || !state.config?.google_client_id) {
      container.innerHTML = `<div class="google-setup-note"><strong>${t('Google sign-in is ready in the code but needs the production Google Client ID.', 'El acceso con Google está listo en el código, pero necesita el Client ID de producción.')}</strong><span>${t('Email sign-in still works below.', 'El acceso por correo sigue funcionando abajo.')}</span></div>`;
      return;
    }
    try {
      await loadGoogleScript();
      if (!state.googleInitialized) {
        window.google.accounts.id.initialize({
          client_id: state.config.google_client_id,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin'
        });
        state.googleInitialized = true;
      }
      container.innerHTML = '';
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'left',
        width: Math.min(420, Math.max(280, container.clientWidth || 360))
      });
    } catch {
      container.innerHTML = `<div class="google-setup-note"><strong>${t('Google sign-in could not load.', 'No se pudo cargar el acceso con Google.')}</strong><span>${t('You can still create or use an email account below.', 'Puede crear o usar una cuenta por correo abajo.')}</span></div>`;
    }
  }

  function emailAuthMarkup() {
    return `<section class="google-auth-card">
      <div><p class="section-kicker">${t('FASTEST SIGN IN', 'ACCESO MÁS RÁPIDO')}</p><h2>${t('Continue with Google', 'Continuar con Google')}</h2><p>${t('Use your Google account. No new password is created for IsMyWaterOK.', 'Use su cuenta de Google. No se crea una contraseña nueva para IsMyWaterOK.')}</p></div>
      <div id="google-primary" class="google-primary" aria-live="polite"></div>
    </section>
    <div class="auth-divider wide-divider">${t('or use email', 'o use correo')}</div>
    <div class="auth-layout">
      <section class="auth-card"><h2>${t('Create account', 'Crear cuenta')}</h2><p>${t('Create a free account with your email.', 'Cree una cuenta gratuita con su correo.')}</p><form id="signup-form" class="community-form"><label><span>${t('Name', 'Nombre')}</span><input id="signup-name" autocomplete="name" maxlength="100" required></label><label><span>${t('Email', 'Correo')}</span><input id="signup-email" type="email" autocomplete="email" required></label><label><span>${t('Password', 'Contraseña')}</span><input id="signup-password" type="password" autocomplete="new-password" minlength="8" required><small>${t('At least 8 characters', 'Al menos 8 caracteres')}</small></label><div class="newsletter-options"><label class="checkbox-line"><input id="signup-updates" type="checkbox" checked><span>${t('Also send me useful Seminole County water updates.', 'También envíeme actualizaciones útiles del agua del Condado de Seminole.')}</span></label><label><span>${t('Email frequency', 'Frecuencia')}</span><select id="signup-frequency"><option value="monthly">${t('Monthly', 'Mensual')}</option><option value="weekly">${t('Weekly', 'Semanal')}</option></select></label></div><button class="primary-button" type="submit">${t('Create account', 'Crear cuenta')}</button></form></section>
      <section class="auth-card"><h2>${t('Sign in with email', 'Ingresar con correo')}</h2><p>${t('Already have an email account?', '¿Ya tiene una cuenta por correo?')}</p><form id="login-form" class="community-form"><label><span>${t('Email', 'Correo')}</span><input id="login-email" type="email" autocomplete="email" required></label><label><span>${t('Password', 'Contraseña')}</span><input id="login-password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">${t('Sign in', 'Ingresar')}</button><button class="small-link-button" type="button" id="forgot-toggle">${t('Forgot your password?', '¿Olvidó su contraseña?')}</button></form><form id="forgot-form" class="community-form" hidden><label><span>${t('Account email', 'Correo de la cuenta')}</span><input id="forgot-email" type="email" autocomplete="email" required></label><button class="primary-button" type="submit">${t('Send reset link', 'Enviar enlace')}</button><button class="small-link-button" type="button" id="back-login">${t('Back to sign in', 'Volver a ingresar')}</button></form></section>
    </div>`;
  }

  function profileMarkup() {
    const initial = esc((state.user.name || state.user.email || '?')[0].toUpperCase());
    const avatar = state.user.picture ? `<img class="profile-avatar" src="${esc(state.user.picture)}" alt="">` : `<div class="profile-avatar">${initial}</div>`;
    const sub = state.subscription || {};
    const methods = (state.user.sign_in_methods || []).map(method => method === 'google' ? 'Google' : t('Email', 'Correo')).join(' + ');
    return `<section class="community-card profile-card"><div class="profile-head">${avatar}<div><h2>${esc(state.user.name || t('Your account', 'Su cuenta'))}</h2><p>${esc(state.user.email)}</p><span class="${state.user.email_verified ? 'verified-pill' : 'unverified-pill'}">${state.user.email_verified ? t('Email verified', 'Correo verificado') : t('Email not verified', 'Correo no verificado')}</span>${methods ? `<span class="sign-in-method">${t('Sign-in method:', 'Método de acceso:')} ${esc(methods)}</span>` : ''}</div></div>${!state.user.email_verified ? `<div class="success-panel"><strong>${t('Verify your email', 'Verifique su correo')}</strong><p>${t('Verification protects your account and keeps account counts accurate.', 'La verificación protege su cuenta y mantiene preciso el conteo de cuentas.')}</p><button id="resend-verification" class="small-link-button" type="button">${t('Send another verification email', 'Enviar otro correo de verificación')}</button></div>` : ''}<div><h3>${t('Water email preferences', 'Preferencias de correos del agua')}</h3><form id="preferences-form" class="community-form"><div class="preferences-grid"><label><span>${t('How often?', '¿Con qué frecuencia?')}</span><select id="pref-frequency"><option value="none"${!sub.active ? ' selected' : ''}>${t('No emails', 'Sin correos')}</option><option value="monthly"${sub.frequency === 'monthly' ? ' selected' : ''}>${t('Monthly', 'Mensual')}</option><option value="weekly"${sub.frequency === 'weekly' ? ' selected' : ''}>${t('Weekly', 'Semanal')}</option></select></label><label><span>${t('Send me', 'Envíeme')}</span><select id="pref-content"><option value="both"${sub.content_type === 'both' ? ' selected' : ''}>${t('Reports + alerts & updates', 'Informes + alertas y novedades')}</option><option value="water-report"${sub.content_type === 'water-report' ? ' selected' : ''}>${t('Water-quality reports', 'Informes de calidad')}</option><option value="alerts-media"${sub.content_type === 'alerts-media' ? ' selected' : ''}>${t('Alerts & community updates', 'Alertas y novedades')}</option></select></label></div><label><span>${t('Community (optional)', 'Comunidad (opcional)')}</span><input id="pref-city" value="${esc(sub.city || '')}" autocomplete="address-level2"></label><button class="primary-button" type="submit">${t('Save preferences', 'Guardar preferencias')}</button></form></div><div class="profile-actions"><a class="small-link-button" href="/feedback.html?from=account">${t('Send feedback', 'Enviar comentarios')}</a><button id="logout-button" class="primary-button" type="button">${t('Sign out', 'Cerrar sesión')}</button></div><div class="danger-zone"><h3>${t('Delete account', 'Eliminar cuenta')}</h3><p>${t('This permanently removes your account and sign-in sessions.', 'Esto elimina permanentemente su cuenta y sesiones.')}</p><button id="delete-account" class="danger-button" type="button">${t('Delete my account', 'Eliminar mi cuenta')}</button></div></section>`;
  }

  function wireSignedOut() {
    $('#signup-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      status(t('Creating account…', 'Creando cuenta…'));
      try {
        const updates = $('#signup-updates').checked;
        const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: $('#signup-name').value, email: $('#signup-email').value, password: $('#signup-password').value, newsletter_frequency: updates ? $('#signup-frequency').value : 'none', content_type: 'both' }) });
        state.user = data.user;
        ga('email_account_created');
        location.href = '/account.html?created=1';
      } catch (error) { status(error.message, 'error'); }
    });
    $('#login-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      status(t('Signing in…', 'Ingresando…'));
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) });
        state.user = data.user;
        ga('email_sign_in_completed');
        location.reload();
      } catch (error) { status(error.message, 'error'); }
    });
    $('#forgot-toggle')?.addEventListener('click', () => { $('#login-form').hidden = true; $('#forgot-form').hidden = false; $('#forgot-email').value = $('#login-email').value; });
    $('#back-login')?.addEventListener('click', () => { $('#forgot-form').hidden = true; $('#login-form').hidden = false; });
    $('#forgot-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const data = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: $('#forgot-email').value }) });
        status(data.message, 'success');
      } catch (error) { status(error.message, 'error'); }
    });
  }

  function wireSignedIn() {
    $('#resend-verification')?.addEventListener('click', async () => {
      try { await api('/api/auth/resend-verification', { method: 'POST', body: '{}' }); status(t('Verification email sent.', 'Correo de verificación enviado.'), 'success'); }
      catch (error) { status(error.message, 'error'); }
    });
    $('#preferences-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await api('/api/auth/preferences', { method: 'POST', body: JSON.stringify({ frequency: $('#pref-frequency').value, content_type: $('#pref-content').value, city: $('#pref-city').value }) });
        status(t('Preferences saved.', 'Preferencias guardadas.'), 'success');
        ga('preferences_saved');
      } catch (error) { status(error.message, 'error'); }
    });
    $('#logout-button')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.href = '/'; });
    $('#delete-account')?.addEventListener('click', async () => {
      if (!confirm(t('Permanently delete your account?', '¿Eliminar permanentemente su cuenta?'))) return;
      try { await api('/api/auth/account', { method: 'DELETE' }); ga('account_deleted'); location.href = '/'; }
      catch (error) { status(error.message, 'error'); }
    });
  }

  async function init() {
    document.documentElement.lang = lang();
    await loadState();
    const root = $('#account-root');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const verified = params.get('verified');
    const google = params.get('google');
    const created = params.get('created');
    const notice = verified === '1' ? t('Email verified. Your account is ready.', 'Correo verificado. Su cuenta está lista.') : verified === '0' ? t('That verification link is invalid or expired.', 'Ese enlace no es válido o venció.') : google === '1' ? t('Signed in with Google.', 'Ha ingresado con Google.') : created === '1' ? t('Account created. Check your inbox to verify your email.', 'Cuenta creada. Revise su correo para verificarla.') : '';
    root.innerHTML = `<p id="account-status" class="form-status${notice ? ' success' : ''}" aria-live="polite">${esc(notice)}</p>${state.user ? profileMarkup() : emailAuthMarkup()}`;
    if (state.user) wireSignedIn();
    else { wireSignedOut(); await renderGoogleSignIn(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
