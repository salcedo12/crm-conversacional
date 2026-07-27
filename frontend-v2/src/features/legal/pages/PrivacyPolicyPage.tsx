import { Link } from 'react-router-dom';

export function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12">
        <header className="border-b border-zinc-800 pb-6">
          <Link to="/login" className="text-sm font-semibold text-violet-300 hover:text-violet-200">
            Meraki CRM
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">
            Politica de Privacidad
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Ultima actualizacion: 27 de julio de 2026</p>
        </header>

        <section className="space-y-4 text-sm leading-6 text-zinc-300">
          <p>
            Grupo Constructor Meraki SAS opera Meraki CRM, una plataforma para gestionar leads,
            conversaciones, llamadas, citas y seguimiento comercial. Esta politica explica como
            recopilamos, usamos y protegemos la informacion de los usuarios de la aplicacion.
          </p>

          <h2 className="text-lg font-semibold text-white">Informacion que recopilamos</h2>
          <p>
            Podemos recopilar datos de cuenta como nombre, correo electronico, rol de usuario,
            informacion de contacto de clientes, conversaciones comerciales, registros de llamadas,
            citas agendadas y configuraciones internas necesarias para prestar el servicio.
          </p>

          <h2 className="text-lg font-semibold text-white">Uso de Google Calendar</h2>
          <p>
            Cuando un usuario conecta Google Calendar, Meraki CRM solicita permisos para consultar
            disponibilidad, crear eventos de citas y generar enlaces de Google Meet. Usamos los datos
            de Google Calendar solamente para mostrar disponibilidad, evitar cruces de agenda, crear,
            actualizar o eliminar citas solicitadas desde el CRM y mostrar el enlace de reunion
            asociado.
          </p>
          <p>
            Meraki CRM puede almacenar el correo de la cuenta conectada, el token de autorizacion
            necesario para mantener la integracion activa, identificadores de eventos y enlaces de
            Google Meet creados por la aplicacion. No vendemos datos de Google Calendar ni los usamos
            para publicidad, retargeting, perfilamiento crediticio o transferencia a brokers de datos.
          </p>

          <h2 className="text-lg font-semibold text-white">Como usamos la informacion</h2>
          <p>
            Utilizamos la informacion para operar el CRM, asignar leads, responder conversaciones,
            agendar citas, enviar recordatorios, generar reportes operativos y mejorar la experiencia
            de los usuarios autorizados de la empresa.
          </p>

          <h2 className="text-lg font-semibold text-white">Comparticion de datos</h2>
          <p>
            La informacion se comparte solo con proveedores necesarios para operar el servicio, como
            infraestructura en la nube, autenticacion, mensajeria, telefonia, almacenamiento y APIs
            integradas autorizadas por la empresa. Estos proveedores procesan datos segun nuestras
            instrucciones y para fines relacionados con la prestacion del servicio.
          </p>

          <h2 className="text-lg font-semibold text-white">Seguridad y retencion</h2>
          <p>
            Aplicamos controles razonables para proteger la informacion contra acceso no autorizado,
            perdida o alteracion. Conservamos los datos mientras sean necesarios para prestar el
            servicio, cumplir obligaciones legales o resolver solicitudes de soporte.
          </p>

          <h2 className="text-lg font-semibold text-white">Eliminacion y desconexion</h2>
          <p>
            Los usuarios pueden desconectar Google Calendar desde la configuracion de Meraki CRM. Al
            desconectar, la aplicacion deja de usar el token de Google para crear o consultar eventos.
            Para solicitar eliminacion de datos o soporte de privacidad, escribe a
            sistemas1.meraki@gmail.com.
          </p>

          <h2 className="text-lg font-semibold text-white">Cambios</h2>
          <p>
            Podemos actualizar esta politica cuando cambien nuestras practicas, funcionalidades o
            requisitos legales. Publicaremos la version vigente en esta pagina.
          </p>
        </section>
      </div>
    </main>
  );
}
