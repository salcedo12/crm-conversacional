/**
 * Impresión / PDF del informe oficial.
 *
 * El layout de la app (sidebar, barra inferior, contenedores con scroll) no se puede
 * limpiar de forma fiable desde CSS, así que justo antes de imprimir se copia el
 * documento a un contenedor hijo directo de <body> y se oculta todo lo demás.
 * Corre en `beforeprint` para cubrir tanto el botón como Ctrl+P.
 */

const REPORT_ELEMENT_ID = 'official-meraki-report-document';
const PRINT_ROOT_ID = 'meraki-report-print-root';
const PRINTING_CLASS = 'meraki-report-printing';

let titleBeforePrint: string | null = null;

export function restoreAfterReportPrint(): void {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.documentElement.classList.remove(PRINTING_CLASS);
  if (titleBeforePrint !== null) {
    document.title = titleBeforePrint;
    titleBeforePrint = null;
  }
}

/** @param fileName nombre sugerido por el navegador al guardar como PDF (sale de document.title). */
export function prepareReportForPrint(fileName: string): void {
  restoreAfterReportPrint();

  const report = document.getElementById(REPORT_ELEMENT_ID);
  if (!report) return;

  const copy = report.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  // Siempre sale con la presentación oficial, aunque en pantalla esté la vista oscura.
  copy.className = 'bg-white text-zinc-900';

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.appendChild(copy);
  document.body.appendChild(root);

  document.documentElement.classList.add(PRINTING_CLASS);
  titleBeforePrint = document.title;
  document.title = fileName;
}

export const OFFICIAL_REPORT_PRINT_CSS = `
  @media screen {
    #${PRINT_ROOT_ID} { display: none !important; }
  }

  @media print {
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
      /* Definir estas cajas evita que el navegador imprima ahí su fecha, título y URL */
      @top-left { content: " "; }
      @top-right { content: " "; }
      @bottom-left { content: " "; }
      @bottom-right {
        content: "Pág. " counter(page) " de " counter(pages);
        font: 700 8px -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        color: #3f3f46;
      }
    }

    html.${PRINTING_CLASS} body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }

    html.${PRINTING_CLASS},
    html.${PRINTING_CLASS} body {
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      background: #ffffff !important;
    }

    #${PRINT_ROOT_ID} * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      box-shadow: none !important;
      transition: none !important;
      animation: none !important;
    }

    /* Controles de pantalla */
    #${PRINT_ROOT_ID} .no-print,
    #${PRINT_ROOT_ID} .official-page-number { display: none !important; }

    #${PRINT_ROOT_ID} h1 { font-size: 19px !important; line-height: 1.2 !important; }

    /* Una hoja por sección, con el pie abajo; sin hoja en blanco al final */
    #${PRINT_ROOT_ID} .official-page {
      min-height: 266mm !important;
      break-after: page;
    }
    #${PRINT_ROOT_ID} .official-page:last-child { break-after: auto; }

    /* Las tablas deben caber completas en el ancho de la hoja */
    #${PRINT_ROOT_ID} .overflow-x-auto {
      overflow: visible !important;
      border-radius: 0 !important;
    }
    #${PRINT_ROOT_ID} table { width: 100% !important; font-size: 9.5px !important; }
    #${PRINT_ROOT_ID} th { font-size: 8.5px !important; padding: 5px 3px !important; }
    #${PRINT_ROOT_ID} td { padding: 4px 3px !important; }
    #${PRINT_ROOT_ID} thead { display: table-header-group; }
    #${PRINT_ROOT_ID} tr { break-inside: avoid; }
    #${PRINT_ROOT_ID} h2,
    #${PRINT_ROOT_ID} h3 { break-after: avoid; }

    /* El subrayado punteado indica "clic para ver detalle": en papel no aplica */
    #${PRINT_ROOT_ID} td .underline { text-decoration: none !important; }
  }
`;
