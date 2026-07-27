import { Link } from 'react-router-dom';

export function TermsPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12">
        <header className="border-b border-zinc-800 pb-6">
          <Link to="/login" className="text-sm font-semibold text-violet-300 hover:text-violet-200">
            Meraki CRM
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">
            Condiciones del Servicio
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Ultima actualizacion: 27 de julio de 2026</p>
        </header>

        <section className="space-y-4 text-sm leading-6 text-zinc-300">
          <p>
            Estas condiciones regulan el uso de Meraki CRM, una plataforma operada por Grupo
            Constructor Meraki SAS para gestion comercial, conversaciones, automatizaciones, llamadas,
            leads, reportes y agendamiento de citas.
          </p>

          <h2 className="text-lg font-semibold text-white">Uso autorizado</h2>
          <p>
            El usuario debe utilizar Meraki CRM solo para fines comerciales legitimos de la empresa y
            de acuerdo con las leyes aplicables. No esta permitido usar la plataforma para actividades
            fraudulentas, envio abusivo de mensajes, acceso no autorizado a datos o cualquier uso que
            afecte la seguridad del servicio.
          </p>

          <h2 className="text-lg font-semibold text-white">Cuentas y acceso</h2>
          <p>
            Cada usuario es responsable de mantener la confidencialidad de sus credenciales y de las
            acciones realizadas desde su cuenta. La empresa puede limitar, suspender o retirar accesos
            cuando sea necesario por seguridad, cumplimiento o administracion interna.
          </p>

          <h2 className="text-lg font-semibold text-white">Integraciones con terceros</h2>
          <p>
            Meraki CRM puede integrarse con servicios externos como Google Calendar, Google Meet,
            proveedores de mensajeria, telefonia, almacenamiento y herramientas de inteligencia
            artificial. El uso de esas integraciones tambien puede estar sujeto a los terminos y
            politicas de cada proveedor.
          </p>

          <h2 className="text-lg font-semibold text-white">Google Calendar y Meet</h2>
          <p>
            Al conectar Google Calendar, el usuario autoriza a Meraki CRM a consultar disponibilidad,
            crear eventos y generar enlaces de Google Meet para citas gestionadas desde la plataforma.
            El usuario puede desconectar esta integracion desde la configuracion del CRM.
          </p>

          <h2 className="text-lg font-semibold text-white">Disponibilidad del servicio</h2>
          <p>
            Trabajamos para mantener la plataforma disponible y segura, pero no garantizamos que el
            servicio sea ininterrumpido o libre de errores. Algunas funciones dependen de proveedores
            externos y pueden verse afectadas por cambios, fallas o limites de esos servicios.
          </p>

          <h2 className="text-lg font-semibold text-white">Datos y privacidad</h2>
          <p>
            El tratamiento de datos personales y datos obtenidos mediante integraciones se describe en
            nuestra <Link to="/privacy" className="text-violet-300 hover:text-violet-200">Politica de Privacidad</Link>.
            El usuario debe contar con autorizacion para cargar, consultar o tratar informacion de
            clientes dentro de Meraki CRM.
          </p>

          <h2 className="text-lg font-semibold text-white">Cambios</h2>
          <p>
            Podemos actualizar estas condiciones cuando cambie la plataforma, la operacion o los
            requisitos legales. La version vigente estara publicada en esta pagina.
          </p>

          <h2 className="text-lg font-semibold text-white">Contacto</h2>
          <p>
            Para preguntas sobre estas condiciones, escribe a sistemas1.meraki@gmail.com.
          </p>
        </section>
      </div>
    </main>
  );
}
