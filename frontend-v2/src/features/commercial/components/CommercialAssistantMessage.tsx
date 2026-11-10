import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  Check,
  Share2,
  Phone,
  ExternalLink,
  UserCheck,
  Megaphone,
  Table as TableIcon,
  Sparkles,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';

interface CommercialAssistantMessageProps {
  content: string;
  isUser: boolean;
  timestamp?: number;
}

export const CommercialAssistantMessage: React.FC<CommercialAssistantMessageProps> = ({
  content,
  isUser,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copying to clipboard:', err);
    }
  };

  const handleCopyWhatsApp = async () => {
    try {
      // Formatear para WhatsApp eliminando headers complejos y dejando negritas de WhatsApp
      const waText = content
        .replace(/###\s+/g, '*— ')
        .replace(/\|\s+/g, ' ')
        .replace(/---/g, '')
        .trim();
      await navigator.clipboard.writeText(waText);
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2000);
    } catch (err) {
      console.error('Error copying WhatsApp text:', err);
    }
  };

  if (isUser) {
    return (
      <div className="bg-amber-500 text-zinc-950 font-medium rounded-2xl rounded-tr-none p-3.5 text-xs leading-relaxed shadow-md">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/95 text-zinc-200 border border-zinc-800 rounded-2xl rounded-tl-none p-4 shadow-xl space-y-3 max-w-full overflow-hidden">
      {/* CONTENIDO FORMATEADO CON REACT-MARKDOWN */}
      <div className="text-xs leading-relaxed text-zinc-200 space-y-2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <div className="mt-4 mb-2 pb-1 border-b border-zinc-800 flex items-center gap-2">
                <Sparkles size={16} className="text-amber-400" />
                <h3 className="text-sm font-black text-white">{children}</h3>
              </div>
            ),
            h2: ({ children }) => (
              <div className="mt-3.5 mb-1.5 pb-1 border-b border-zinc-800/80 flex items-center gap-2">
                <Sparkles size={15} className="text-amber-400" />
                <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                  {children}
                </h3>
              </div>
            ),
            h3: ({ children }) => {
              const text = String(children || '');
              const lower = text.toLowerCase();

              let IconComponent = Sparkles;
              let badgeColor = 'bg-amber-500/10 text-amber-300 border-amber-500/30';

              if (lower.includes('asesor') || lower.includes('ranking')) {
                IconComponent = UserCheck;
                badgeColor = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
              } else if (lower.includes('campaña') || lower.includes('pauta') || lower.includes('meta')) {
                IconComponent = Megaphone;
                badgeColor = 'bg-sky-500/15 text-sky-300 border-sky-500/30';
              } else if (lower.includes('prospecto') || lower.includes('muestra') || lower.includes('tabla')) {
                IconComponent = TableIcon;
                badgeColor = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
              } else if (lower.includes('observaci') || lower.includes('diagn') || lower.includes('recomenda') || lower.includes('atenci')) {
                IconComponent = Lightbulb;
                badgeColor = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
              }

              return (
                <div className="mt-4 mb-2 pt-2 border-t border-zinc-800/60 first:mt-0 first:pt-0 first:border-0">
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold tracking-wide shadow-xs ${badgeColor}`}
                  >
                    <IconComponent size={13} />
                    <span>{children}</span>
                  </div>
                </div>
              );
            },
            p: ({ children }) => (
              <p className="my-1.5 text-zinc-300 leading-relaxed text-xs">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-bold text-amber-300">{children}</strong>
            ),
            ul: ({ children }) => (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 my-2.5 list-none p-0">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="space-y-1.5 my-2 pl-4 list-decimal text-zinc-300">{children}</ol>
            ),
            li: ({ children }) => {
              // Convertir children a texto seguro para detectar alertas sin JSON.stringify
              const extractText = (node: any): string => {
                if (!node) return '';
                if (typeof node === 'string' || typeof node === 'number') return String(node);
                if (Array.isArray(node)) return node.map(extractText).join(' ');
                if (typeof node === 'object' && node.props?.children) return extractText(node.props.children);
                return '';
              };

              const textContent = extractText(children);
              const isSinAsignar = textContent.toLowerCase().includes('sin asignar');

              return (
                <li
                  className={`flex items-center justify-between gap-2 p-2 rounded-xl text-xs transition border ${
                    isSinAsignar
                      ? 'bg-rose-500/10 text-rose-200 border-rose-500/40'
                      : 'bg-zinc-950/70 text-zinc-200 border-zinc-800/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isSinAsignar ? (
                      <AlertTriangle size={13} className="text-rose-400 flex-shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    )}
                    <div className="truncate text-[11px]">{children}</div>
                  </div>
                </li>
              );
            },
            table: ({ children }) => (
              <div className="my-3 overflow-x-auto rounded-2xl border border-zinc-800/90 bg-zinc-950/90 shadow-lg">
                <table className="w-full text-left text-xs border-collapse">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-zinc-900 text-amber-400 uppercase tracking-wider text-[10px] font-bold border-b border-zinc-800">
                {children}
              </thead>
            ),
            tbody: ({ children }) => (
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40 font-normal">
                {children}
              </tbody>
            ),
            tr: ({ children }) => (
              <tr className="hover:bg-zinc-900/60 transition-colors">
                {children}
              </tr>
            ),
            th: ({ children }) => (
              <th className="py-2.5 px-3 text-zinc-300 font-bold whitespace-nowrap">
                {children}
              </th>
            ),
            td: ({ children }) => {
              const text = String(children || '').trim();
              const digits = text.replace(/\D/g, '');
              const isPhone =
                digits.length >= 10 &&
                (text.startsWith('+') || text.startsWith('3') || text.startsWith('57'));

              if (isPhone) {
                const cleanPhone =
                  digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <a
                      href={`https://wa.me/${cleanPhone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono font-bold transition"
                      title="Abrir chat en WhatsApp"
                    >
                      <Phone size={10} className="text-emerald-400" />
                      <span>{children}</span>
                      <ExternalLink size={9} className="opacity-70" />
                    </a>
                  </td>
                );
              }

              const lower = text.toLowerCase();
              if (lower === 'new' || lower === 'nuevo') {
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      Nuevo
                    </span>
                  </td>
                );
              }
              if (lower === 'qualified' || lower === 'calificado' || lower.includes('visita')) {
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Calificado
                    </span>
                  </td>
                );
              }
              if (lower.includes('no contesta') || lower.includes('sin resp')) {
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                      No Contesta
                    </span>
                  </td>
                );
              }
              if (lower.includes('desist') || lower.includes('perdid')) {
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Desistido
                    </span>
                  </td>
                );
              }
              if (lower.includes('venta') || lower.includes('ganad') || lower.includes('vend')) {
                return (
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Venta Real
                    </span>
                  </td>
                );
              }

              return (
                <td className="py-2 px-3 whitespace-normal text-zinc-300">
                  {children}
                </td>
              );
            },
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-amber-500/70 bg-amber-500/10 p-3 rounded-r-xl my-2 text-xs text-amber-200/90 italic">
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300 font-mono text-[11px] border border-zinc-700/60">
                {children}
              </code>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {/* BARRA DE ACCIONES EJECUTIVAS: COPIAR Y COMPARTIR */}
      <div className="pt-2.5 mt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
        <span className="text-[10px] text-zinc-500">Grupo Meraki • IA Auditoría</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyWhatsApp}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-emerald-500/20 text-zinc-300 hover:text-emerald-300 border border-zinc-700/60 hover:border-emerald-500/40 text-[10px] font-medium transition cursor-pointer"
            title="Copiar texto listo para enviar a WhatsApp"
          >
            {copiedWhatsApp ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span className="text-emerald-400 font-bold">¡Copiado para WhatsApp!</span>
              </>
            ) : (
              <>
                <Share2 size={11} className="text-emerald-400" />
                <span>Copiar para WhatsApp</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-[10px] font-medium transition cursor-pointer"
            title="Copiar respuesta completa"
          >
            {copied ? (
              <>
                <Check size={11} className="text-amber-400" />
                <span className="text-amber-400 font-bold">Copiado</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
