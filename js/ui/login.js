import { h, vaciar, campo } from './dom.js';
import { sesion } from '../data/repos.js';

// Bloqueo local tras 5 intentos fallidos (15 minutos). Es una protección adicional
// en este navegador; el límite real lo aplica Supabase en el servidor.
const MAX_INTENTOS = 5;
const ESPERA_MIN = 15;
const CLAVE = 'mw_intentos_login';

function leerIntentos() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) ?? { n: 0, hasta: 0 }; } catch { return { n: 0, hasta: 0 }; }
}
function guardarIntentos(v) { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export function pantallaLogin(raiz) {
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' });
  const clave = h('input', { type: 'password', name: 'clave', required: true, autocomplete: 'current-password' });
  const msg = h('p', { class: 'form-error', hidden: true });
  const btn = h('button', { class: 'btn btn-primario btn-ancho', type: 'submit' }, 'Ingresar');

  const form = h('form', {
    class: 'login-caja',
    onsubmit: async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const intentos = leerIntentos();
      if (intentos.hasta > Date.now()) {
        const min = Math.ceil((intentos.hasta - Date.now()) / 60000);
        msg.textContent = `Demasiados intentos fallidos. Probá de nuevo en ${min} minuto(s).`;
        msg.hidden = false;
        return;
      }
      btn.disabled = true; btn.textContent = 'Ingresando…';
      try {
        await sesion.entrar(email.value.trim(), clave.value);
        guardarIntentos({ n: 0, hasta: 0 });
      } catch (err) {
        const n = intentos.n + 1;
        guardarIntentos(n >= MAX_INTENTOS ? { n: 0, hasta: Date.now() + ESPERA_MIN * 60000 } : { n, hasta: 0 });
        msg.textContent = n >= MAX_INTENTOS
          ? `${err.message} Se bloqueó el ingreso por ${ESPERA_MIN} minutos.`
          : `${err.message} (intento ${n} de ${MAX_INTENTOS})`;
        msg.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = 'Ingresar';
      }
    },
  },
    h('div', { class: 'login-marca' }, h('span', { class: 'marca-logo' }, 'MW'), h('div', {},
      h('strong', {}, 'MADEWORK'), h('small', {}, 'Sistema contable y de gestión'))),
    campo('Correo electrónico', email),
    campo('Contraseña', clave),
    msg,
    btn,
    h('p', { class: 'login-nota' }, 'Los usuarios los crea el administrador. Si olvidaste la contraseña, pedile que la restablezca.'),
  );
  vaciar(raiz, h('main', { class: 'login' }, form));
  email.focus();
}
