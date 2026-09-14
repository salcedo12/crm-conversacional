/**
 * URLs de las banderas SVG (de flag-icons) SOLO de los países que usamos, para no
 * inflar el bundle con las ~250 del mundo. Se usan imágenes (no emojis) porque
 * Windows no renderiza los emojis de bandera. Añade aquí un país si amplías mercado.
 */
import us from 'flag-icons/flags/4x3/us.svg';
import mx from 'flag-icons/flags/4x3/mx.svg';
import co from 'flag-icons/flags/4x3/co.svg';
import pe from 'flag-icons/flags/4x3/pe.svg';
import ve from 'flag-icons/flags/4x3/ve.svg';
import cl from 'flag-icons/flags/4x3/cl.svg';
import ar from 'flag-icons/flags/4x3/ar.svg';
import br from 'flag-icons/flags/4x3/br.svg';
import ec from 'flag-icons/flags/4x3/ec.svg';
import bo from 'flag-icons/flags/4x3/bo.svg';
import py from 'flag-icons/flags/4x3/py.svg';
import uy from 'flag-icons/flags/4x3/uy.svg';
import pa from 'flag-icons/flags/4x3/pa.svg';
import cr from 'flag-icons/flags/4x3/cr.svg';
import gt from 'flag-icons/flags/4x3/gt.svg';
import sv from 'flag-icons/flags/4x3/sv.svg';
import hn from 'flag-icons/flags/4x3/hn.svg';
import ni from 'flag-icons/flags/4x3/ni.svg';
import es from 'flag-icons/flags/4x3/es.svg';
import pt from 'flag-icons/flags/4x3/pt.svg';
import gb from 'flag-icons/flags/4x3/gb.svg';
import it from 'flag-icons/flags/4x3/it.svg';
import fr from 'flag-icons/flags/4x3/fr.svg';
import de from 'flag-icons/flags/4x3/de.svg';

export const FLAG_URLS: Record<string, string> = {
  us, mx, co, pe, ve, cl, ar, br, ec, bo, py, uy, pa, cr, gt, sv, hn, ni,
  es, pt, gb, it, fr, de,
};
