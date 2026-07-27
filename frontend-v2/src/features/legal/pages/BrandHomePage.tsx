import { Link } from 'react-router-dom';

export function BrandHomePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-12">
        <header className="border-b border-zinc-800 pb-8">
          <p className="text-sm font-semibold text-violet-300">Pagina principal oficial</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-normal text-white md:text-5xl">
            Meraki CRM
          </h1>
          <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-normal text-white">
            CRM conversacional para gestion comercial y agendamiento de citas
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-400">
            Meraki CRM ayuda a equipos comerciales a centralizar conversaciones, leads,
            llamadas, seguimiento, reportes y citas desde una sola plataforma.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Ir a la aplicacion
            </Link>
            <Link
              to="/privacy"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
            >
              Politica de privacidad
            </Link>
            <Link
              to="/terms"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
            >
              Condiciones del servicio
            </Link>
          </div>
        </header>

        <section className="space-y-4 text-sm leading-6 text-zinc-300">
          <h2 className="text-xl font-semibold text-white">Proposito de Meraki CRM</h2>
          <p>
            Meraki CRM es una aplicacion web que permite gestionar clientes potenciales, responder conversaciones comerciales,
            registrar llamadas, asignar asesores y agendar citas. La plataforma usa integraciones
            autorizadas para facilitar el seguimiento de oportunidades y reducir tareas manuales.
          </p>
        </section>

        <section className="space-y-4 text-sm leading-6 text-zinc-300">
          <h2 className="text-xl font-semibold text-white">Integracion con Google Calendar</h2>
          <p>
            Los usuarios autorizados pueden conectar Google Calendar para consultar disponibilidad,
            evitar cruces de agenda, crear eventos de citas comerciales y generar enlaces de Google
            Meet asociados a esas citas. El usuario puede desconectar esta integracion desde la
            configuracion de la aplicacion.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white">Funciones principales</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <article className="rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white">Leads y conversaciones</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Centraliza contactos, historial comercial y mensajes de clientes potenciales.
              </p>
            </article>
            <article className="rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white">Agenda y reuniones</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Crea citas comerciales, consulta disponibilidad y genera enlaces de Google Meet.
              </p>
            </article>
            <article className="rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white">Seguimiento comercial</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Organiza tareas, reportes y actividad de asesores para mejorar la operacion.
              </p>
            </article>
          </div>
        </section>

        <footer className="border-t border-zinc-800 pt-6 text-sm text-zinc-400">
          Contacto: <span className="text-zinc-200">sistemas1.meraki@gmail.com</span>
        </footer>
      </div>
    </main>
  );
}
